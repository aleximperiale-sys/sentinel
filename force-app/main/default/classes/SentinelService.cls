/**
 * SentinelService, core staleness engine shared by every Sentinel entry point
 * (invocable actions, the scheduled monitor, and the LWC dashboard).
 *
 * All object-specific knowledge comes from Sentinel_Config__mdt, so one class
 * serves every configured object. Domain classes are @AuraEnabled so they can be
 * returned straight to LWC and JSON.serialize'd for the agent.
 */
public with sharing class SentinelService {

    public class SentinelException extends Exception {}

    // ---------------------------------------------------------------- Domain
    public class RecordInfo {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public String ownerId;
        @AuraEnabled public String ownerName;
        @AuraEnabled public String priority;
        @AuraEnabled public Integer ageDays;
        @AuraEnabled public String band;   // Aging | Stale | Critical
        @AuraEnabled public String url;
        @AuraEnabled public Datetime lastModifiedDate;
        @AuraEnabled public String lastActivitySubject;
        @AuraEnabled public Date lastActivityDate;
        @AuraEnabled public String nextStepSubject;
        @AuraEnabled public Date nextStepDate;
        @AuraEnabled public Double amount;
        @AuraEnabled public Boolean isSingleThreaded; // Opportunity only; null when not applicable
        @AuraEnabled public String explanation;
        @AuraEnabled public Boolean snoozed;
        @AuraEnabled public Date snoozedUntil;
    }

    public class GroupCount {
        @AuraEnabled public String key;
        @AuraEnabled public Integer count;
        public GroupCount(String k, Integer c) { key = k; count = c; }
    }

    public class Summary {
        @AuraEnabled public List<GroupCount> byOwner = new List<GroupCount>();
        @AuraEnabled public List<GroupCount> byPriority = new List<GroupCount>();
        @AuraEnabled public List<GroupCount> byBand = new List<GroupCount>();
    }

    public class Report {
        @AuraEnabled public String objectApiName;
        @AuraEnabled public String label;
        @AuraEnabled public Integer thresholdDays;
        @AuraEnabled public Integer staleCount;
        @AuraEnabled public List<RecordInfo> records = new List<RecordInfo>();
        @AuraEnabled public Summary summary = new Summary();
    }

    // ------------------------------------------------------------- Config I/O
    private static final String CONFIG_FIELDS =
        'Object_API_Name__c, Date_Field__c, Stale_Days__c, Owner_Field__c, ' +
        'Priority_Field__c, Name_Field__c, Filter_Criteria__c, Sort_Field__c, ' +
        'Sort_Direction__c, Threshold_Alert__c, Is_Active__c, Label__c, Amount_Field__c';

    public static Sentinel_Config__mdt getConfig(String objectApiName) {
        List<Sentinel_Config__mdt> cfgs = Database.query(
            'SELECT ' + CONFIG_FIELDS + ' FROM Sentinel_Config__mdt ' +
            'WHERE Object_API_Name__c = :objectApiName LIMIT 1'
        );
        if (cfgs.isEmpty()) {
            throw new SentinelException('No Sentinel_Config__mdt found for object: ' + objectApiName);
        }
        return cfgs[0];
    }

    public static List<Sentinel_Config__mdt> getActiveConfigs() {
        return Database.query(
            'SELECT ' + CONFIG_FIELDS + ' FROM Sentinel_Config__mdt ' +
            'WHERE Is_Active__c = true ORDER BY Label__c'
        );
    }

    // ---------------------------------------------------------------- Run
    public static Report runCheck(String objectApiName, String ownerScope) {
        return runCheck(getConfig(objectApiName), ownerScope);
    }

    public static Report runCheck(Sentinel_Config__mdt cfg, String ownerScope) {
        String nameField  = blankDefault(cfg.Name_Field__c, 'Name');
        String ownerField = blankDefault(cfg.Owner_Field__c, 'OwnerId');
        String dateField  = cfg.Date_Field__c.trim();
        Integer threshold = Integer.valueOf(cfg.Stale_Days__c);
        Boolean scopeMine = ownerScope == 'mine';

        assertSafe(cfg.Object_API_Name__c);
        assertSafe(nameField);
        assertSafe(ownerField);
        assertSafe(dateField);

        Set<String> fields = new Set<String>{ 'Id', nameField, ownerField, dateField, 'LastModifiedDate' };
        Boolean hasPriority = String.isNotBlank(cfg.Priority_Field__c);
        String priorityField = hasPriority ? cfg.Priority_Field__c.trim() : null;
        if (hasPriority) { assertSafe(priorityField); fields.add(priorityField); }
        Boolean resolveOwnerName = ownerField.equalsIgnoreCase('OwnerId');
        if (resolveOwnerName) { fields.add('Owner.Name'); }
        Boolean hasAmount = String.isNotBlank(cfg.Amount_Field__c);
        String amountField = hasAmount ? cfg.Amount_Field__c.trim() : null;
        if (hasAmount) { assertSafe(amountField); fields.add(amountField); }

        String sortField = blankDefault(cfg.Sort_Field__c, dateField);
        assertSafe(sortField);
        String sortDir = blankDefault(cfg.Sort_Direction__c, 'ASC').toUpperCase();
        if (sortDir != 'ASC' && sortDir != 'DESC') { sortDir = 'ASC'; }

        Id currentUserId = UserInfo.getUserId();
        String q = 'SELECT ' + String.join(new List<String>(fields), ', ') +
            ' FROM ' + cfg.Object_API_Name__c +
            ' WHERE ' + dateField + ' < LAST_N_DAYS:' + threshold;
        if (String.isNotBlank(cfg.Filter_Criteria__c)) { q += ' AND (' + cfg.Filter_Criteria__c + ')'; }
        if (scopeMine) { q += ' AND ' + ownerField + ' = :currentUserId'; }
        q += ' ORDER BY ' + sortField + ' ' + sortDir + ' NULLS LAST LIMIT 200';

        List<SObject> rows = Database.query(q);

        Report rep = new Report();
        rep.objectApiName = cfg.Object_API_Name__c;
        rep.label = blankDefault(cfg.Label__c, cfg.Object_API_Name__c);
        rep.thresholdDays = threshold;

        Set<Id> ids = new Set<Id>();
        for (SObject row : rows) { ids.add((Id) row.get('Id')); }

        Map<Id, Date> snoozeMap = getSnoozeMap(ids);
        Map<Id, Task> lastActivityMap = new Map<Id, Task>();
        Map<Id, Task> nextStepMap = new Map<Id, Task>();
        if (cfg.Object_API_Name__c != 'Task' && !ids.isEmpty()) {
            lastActivityMap = getLastActivityMap(ids);
            nextStepMap = getNextStepMap(ids);
        }
        Map<Id, Integer> contactRoleCounts = cfg.Object_API_Name__c == 'Opportunity'
            ? getContactRoleCounts(ids) : new Map<Id, Integer>();

        String base = URL.getOrgDomainUrl().toExternalForm();
        Map<String, Integer> ownerMap = new Map<String, Integer>();
        Map<String, Integer> prioMap = new Map<String, Integer>();
        Map<String, Integer> bandMap = new Map<String, Integer>();

        for (SObject row : rows) {
            Id rowId = (Id) row.get('Id');
            if (snoozeMap.containsKey(rowId)) { continue; } // still snoozed, leave off the at-risk list

            RecordInfo ri = new RecordInfo();
            ri.id = rowId;
            Object nm = row.get(nameField);
            ri.name = nm == null ? '(no name)' : String.valueOf(nm);
            ri.ownerId = String.valueOf(row.get(ownerField));
            if (resolveOwnerName && row.getSObject('Owner') != null) {
                ri.ownerName = (String) row.getSObject('Owner').get('Name');
            }
            if (hasPriority) {
                Object pv = row.get(priorityField);
                ri.priority = pv == null ? null : String.valueOf(pv);
            }
            if (hasAmount) {
                Object av = row.get(amountField);
                ri.amount = av == null ? null : Double.valueOf(av);
            }
            ri.ageDays = ageInDays(row.get(dateField));
            ri.band = band(ri.ageDays, threshold);
            ri.url = base + '/lightning/r/' + ri.id + '/view';
            ri.lastModifiedDate = (Datetime) row.get('LastModifiedDate');
            ri.explanation = buildExplanation(ri.ageDays, threshold, ri.band);

            if (lastActivityMap.containsKey(rowId)) {
                Task t = lastActivityMap.get(rowId);
                ri.lastActivitySubject = t.Subject;
                ri.lastActivityDate = t.ActivityDate;
            }
            if (nextStepMap.containsKey(rowId)) {
                Task t = nextStepMap.get(rowId);
                ri.nextStepSubject = t.Subject;
                ri.nextStepDate = t.ActivityDate;
            }
            if (contactRoleCounts.containsKey(rowId)) {
                ri.isSingleThreaded = contactRoleCounts.get(rowId) <= 1;
            } else if (cfg.Object_API_Name__c == 'Opportunity') {
                ri.isSingleThreaded = true; // zero contact roles found
            }

            rep.records.add(ri);
            bump(ownerMap, ri.ownerName != null ? ri.ownerName : (ri.ownerId != null ? ri.ownerId : 'Unassigned'));
            bump(prioMap, ri.priority != null ? ri.priority : '(none)');
            bump(bandMap, ri.band);
        }
        rep.staleCount = rep.records.size();
        rep.summary.byOwner = toGroupCounts(ownerMap);
        rep.summary.byPriority = toGroupCounts(prioMap);
        rep.summary.byBand = toGroupCounts(bandMap);
        return rep;
    }

    // ------------------------------------------------------------ Enrichment
    private static String buildExplanation(Integer ageDays, Integer threshold, String bandLabel) {
        if (ageDays == null) { return 'No staleness date on record, treated as Aging.'; }
        Decimal ratio = threshold > 0
            ? Decimal.valueOf(ageDays).divide(threshold, 1)
            : Decimal.valueOf(0);
        return ageDays + ' days since the tracked date vs. a ' + threshold + '-day threshold (' +
            ratio + 'x) = ' + bandLabel + '.';
    }

    private static Map<Id, Date> getSnoozeMap(Set<Id> ids) {
        Map<Id, Date> out = new Map<Id, Date>();
        if (ids.isEmpty()) { return out; }
        for (Sentinel_Snooze__c s : [
            SELECT Record_Id__c, Snoozed_Until__c FROM Sentinel_Snooze__c
            WHERE Record_Id__c IN :idsToStrings(ids) AND Snoozed_Until__c >= TODAY
        ]) {
            out.put((Id) s.Record_Id__c, s.Snoozed_Until__c);
        }
        return out;
    }

    private static List<String> idsToStrings(Set<Id> ids) {
        List<String> out = new List<String>();
        for (Id i : ids) { out.add(String.valueOf(i)); }
        return out;
    }

    /** Most recent completed activity per WhatId/WhoId, for records other than Task. */
    private static Map<Id, Task> getLastActivityMap(Set<Id> ids) {
        Map<Id, Task> out = new Map<Id, Task>();
        for (Task t : [
            SELECT WhatId, WhoId, Subject, ActivityDate FROM Task
            WHERE (WhatId IN :ids OR WhoId IN :ids) AND Status = 'Completed'
            ORDER BY ActivityDate DESC NULLS LAST LIMIT 500
        ]) {
            Id key = t.WhatId != null && ids.contains(t.WhatId) ? t.WhatId : t.WhoId;
            if (key != null && !out.containsKey(key)) { out.put(key, t); } // first = most recent (DESC)
        }
        return out;
    }

    /** Earliest open (not-yet-completed) activity per WhatId/WhoId, the "next step". */
    private static Map<Id, Task> getNextStepMap(Set<Id> ids) {
        Map<Id, Task> out = new Map<Id, Task>();
        for (Task t : [
            SELECT WhatId, WhoId, Subject, ActivityDate FROM Task
            WHERE (WhatId IN :ids OR WhoId IN :ids) AND Status != 'Completed'
            ORDER BY ActivityDate ASC NULLS LAST LIMIT 500
        ]) {
            Id key = t.WhatId != null && ids.contains(t.WhatId) ? t.WhatId : t.WhoId;
            if (key != null && !out.containsKey(key)) { out.put(key, t); } // first = soonest (ASC)
        }
        return out;
    }

    /** Distinct contact count per Opportunity, via OpportunityContactRole. */
    private static Map<Id, Integer> getContactRoleCounts(Set<Id> oppIds) {
        Map<Id, Integer> out = new Map<Id, Integer>();
        if (oppIds.isEmpty()) { return out; }
        for (AggregateResult ar : [
            SELECT OpportunityId oppId, COUNT(Id) cnt FROM OpportunityContactRole
            WHERE OpportunityId IN :oppIds GROUP BY OpportunityId
        ]) {
            out.put((Id) ar.get('oppId'), (Integer) ar.get('cnt'));
        }
        return out;
    }

    // ---------------------------------------------------------------- Helpers
    private static String blankDefault(String v, String fallback) {
        return String.isBlank(v) ? fallback : v.trim();
    }

    private static void bump(Map<String, Integer> m, String key) {
        m.put(key, (m.containsKey(key) ? m.get(key) : 0) + 1);
    }

    private static Integer ageInDays(Object dateVal) {
        if (dateVal == null) { return null; }
        Date d;
        if (dateVal instanceof Datetime) { d = ((Datetime) dateVal).date(); }
        else if (dateVal instanceof Date) { d = (Date) dateVal; }
        else { return null; }
        return d.daysBetween(Date.today());
    }

    private static String band(Integer ageDays, Integer threshold) {
        if (ageDays == null) { return 'Aging'; }
        if (ageDays >= threshold * 3) { return 'Critical'; }
        if (ageDays >= threshold * 2) { return 'Stale'; }
        return 'Aging';
    }

    public static List<GroupCount> toGroupCounts(Map<String, Integer> m) {
        List<GroupCount> out = new List<GroupCount>();
        for (String k : m.keySet()) { out.add(new GroupCount(k, m.get(k))); }
        // simple descending selection sort, result sets are small (grouped keys)
        for (Integer i = 0; i < out.size(); i++) {
            for (Integer j = i + 1; j < out.size(); j++) {
                if (out[j].count > out[i].count) {
                    GroupCount tmp = out[i]; out[i] = out[j]; out[j] = tmp;
                }
            }
        }
        return out;
    }

    /** Parses a comma-separated list of record Ids, skipping blanks/malformed. */
    public static List<Id> parseIds(String csv) {
        List<Id> ids = new List<Id>();
        if (String.isBlank(csv)) { return ids; }
        for (String s : csv.split(',')) {
            String v = s.trim();
            if (String.isBlank(v)) { continue; }
            try { ids.add((Id) v); } catch (Exception e) { /* skip malformed */ }
        }
        return ids;
    }

    private static final Pattern SAFE = Pattern.compile('^[A-Za-z0-9_\\.]+$');
    private static void assertSafe(String ident) {
        if (ident == null || !SAFE.matcher(ident).matches()) {
            throw new SentinelException('Unsafe identifier in Sentinel config: ' + ident);
        }
    }
}
