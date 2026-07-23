/**
 * Read-only controller for the Sentinel LWC dashboard. Returns per-object health
 * with freshness bands, top owners, and the record list, all from SentinelService.
 */
public with sharing class SentinelDashboardController {

    public class ObjectHealth {
        @AuraEnabled public String objectApiName;
        @AuraEnabled public String label;
        @AuraEnabled public Integer staleCount;
        @AuraEnabled public Integer thresholdDays;
        @AuraEnabled public Integer aging;
        @AuraEnabled public Integer stale;
        @AuraEnabled public Integer critical;
        @AuraEnabled public List<SentinelService.GroupCount> topOwners;
        @AuraEnabled public List<SentinelService.RecordInfo> records;
    }

    public class Overview {
        @AuraEnabled public Integer totalAtRisk;
        @AuraEnabled public Integer objectCount;
        @AuraEnabled public Integer critical;
        @AuraEnabled public List<ObjectHealth> objects;
    }

    @AuraEnabled(cacheable=true)
    public static Overview getOverview(String ownerScope) {
        String scope = String.isBlank(ownerScope) ? 'all' : ownerScope.toLowerCase();
        Overview ov = new Overview();
        ov.objects = new List<ObjectHealth>();
        ov.totalAtRisk = 0;
        ov.critical = 0;

        for (Sentinel_Config__mdt cfg : SentinelService.getActiveConfigs()) {
            SentinelService.Report rep = SentinelService.runCheck(cfg, scope);
            ObjectHealth oh = new ObjectHealth();
            oh.objectApiName = rep.objectApiName;
            oh.label = rep.label;
            oh.staleCount = rep.staleCount;
            oh.thresholdDays = rep.thresholdDays;
            oh.aging = 0; oh.stale = 0; oh.critical = 0;
            for (SentinelService.GroupCount g : rep.summary.byBand) {
                if (g.key == 'Aging') { oh.aging = g.count; }
                else if (g.key == 'Stale') { oh.stale = g.count; }
                else if (g.key == 'Critical') { oh.critical = g.count; }
            }
            oh.topOwners = rep.summary.byOwner;
            oh.records = rep.records;
            ov.objects.add(oh);
            ov.totalAtRisk += rep.staleCount;
            ov.critical += oh.critical;
        }
        ov.objectCount = ov.objects.size();
        return ov;
    }

    // ---------------------------------------------------------------- Trends
    public class TrendPoint {
        @AuraEnabled public String snapshotDate;
        @AuraEnabled public Integer staleCount;
        @AuraEnabled public Integer criticalCount;
    }
    public class ObjectTrend {
        @AuraEnabled public String objectApiName;
        @AuraEnabled public String label;
        @AuraEnabled public List<TrendPoint> points;
    }

    @AuraEnabled(cacheable=true)
    public static List<ObjectTrend> getTrends(Integer daysBack) {
        Integer lookback = daysBack == null ? 14 : daysBack;
        Date since = Date.today().addDays(-lookback);
        Map<String, ObjectTrend> byObject = new Map<String, ObjectTrend>();
        for (Sentinel_Snapshot__c s : [
            SELECT Object_API_Name__c, Label__c, Snapshot_Date__c, Stale_Count__c, Critical_Count__c
            FROM Sentinel_Snapshot__c
            WHERE Snapshot_Date__c >= :since
            ORDER BY Object_API_Name__c, Snapshot_Date__c ASC
        ]) {
            if (!byObject.containsKey(s.Object_API_Name__c)) {
                ObjectTrend t = new ObjectTrend();
                t.objectApiName = s.Object_API_Name__c;
                t.label = s.Label__c;
                t.points = new List<TrendPoint>();
                byObject.put(s.Object_API_Name__c, t);
            }
            TrendPoint p = new TrendPoint();
            p.snapshotDate = s.Snapshot_Date__c.format();
            p.staleCount = Integer.valueOf(s.Stale_Count__c);
            p.criticalCount = Integer.valueOf(s.Critical_Count__c);
            byObject.get(s.Object_API_Name__c).points.add(p);
        }
        return byObject.values();
    }

    // ------------------------------------------------------------ Leaderboard
    @AuraEnabled(cacheable=true)
    public static List<SentinelService.GroupCount> getLeaderboard(String objectApiName) {
        List<Sentinel_Config__mdt> configs = String.isBlank(objectApiName)
            ? SentinelService.getActiveConfigs()
            : new List<Sentinel_Config__mdt>{ SentinelService.getConfig(objectApiName) };
        Map<String, Integer> ownerTotals = new Map<String, Integer>();
        for (Sentinel_Config__mdt cfg : configs) {
            SentinelService.Report rep = SentinelService.runCheck(cfg, 'all');
            for (SentinelService.GroupCount gc : rep.summary.byOwner) {
                ownerTotals.put(gc.key, (ownerTotals.containsKey(gc.key) ? ownerTotals.get(gc.key) : 0) + gc.count);
            }
        }
        return SentinelService.toGroupCounts(ownerTotals);
    }

    // --------------------------------------------------------------- Snoozed
    public class SnoozedRecord {
        @AuraEnabled public String recordId;
        @AuraEnabled public String objectApiName;
        @AuraEnabled public String displayName;
        @AuraEnabled public String reason;
        @AuraEnabled public String snoozedByName;
        @AuraEnabled public String snoozedUntil;
        @AuraEnabled public Integer daysRemaining;
    }

    @AuraEnabled(cacheable=true)
    public static List<SnoozedRecord> getSnoozed() {
        List<Sentinel_Snooze__c> rows = [
            SELECT Record_Id__c, Object_API_Name__c, Reason__c, Snoozed_Until__c, Snoozed_By__r.Name
            FROM Sentinel_Snooze__c
            WHERE Snoozed_Until__c >= TODAY
            ORDER BY Snoozed_Until__c ASC
        ];
        Map<String, Map<Id, String>> namesByObject = resolveDisplayNames(rows);

        List<SnoozedRecord> out = new List<SnoozedRecord>();
        for (Sentinel_Snooze__c row : rows) {
            SnoozedRecord sr = new SnoozedRecord();
            sr.recordId = row.Record_Id__c;
            sr.objectApiName = row.Object_API_Name__c;
            Map<Id, String> names = namesByObject.get(row.Object_API_Name__c);
            sr.displayName = names != null && names.containsKey(row.Record_Id__c)
                ? names.get(row.Record_Id__c) : row.Record_Id__c;
            sr.reason = row.Reason__c;
            sr.snoozedByName = row.Snoozed_By__r != null ? row.Snoozed_By__r.Name : null;
            sr.snoozedUntil = row.Snoozed_Until__c.format();
            sr.daysRemaining = Date.today().daysBetween(row.Snoozed_Until__c);
            out.add(sr);
        }
        return out;
    }

    private static Map<String, Map<Id, String>> resolveDisplayNames(List<Sentinel_Snooze__c> rows) {
        Map<String, Set<Id>> idsByObject = new Map<String, Set<Id>>();
        for (Sentinel_Snooze__c row : rows) {
            if (!idsByObject.containsKey(row.Object_API_Name__c)) {
                idsByObject.put(row.Object_API_Name__c, new Set<Id>());
            }
            try { idsByObject.get(row.Object_API_Name__c).add((Id) row.Record_Id__c); } catch (Exception e) { /* skip malformed */ }
        }
        Map<String, Map<Id, String>> out = new Map<String, Map<Id, String>>();
        for (String objectApiName : idsByObject.keySet()) {
            Map<Id, String> names = new Map<Id, String>();
            Set<Id> ids = idsByObject.get(objectApiName);
            try {
                Sentinel_Config__mdt cfg = SentinelService.getConfig(objectApiName);
                String nameField = String.isBlank(cfg.Name_Field__c) ? 'Name' : cfg.Name_Field__c.trim();
                for (SObject so : Database.query(
                    'SELECT Id, ' + nameField + ' FROM ' + objectApiName + ' WHERE Id IN :ids'
                )) {
                    Object nm = so.get(nameField);
                    names.put((Id) so.get('Id'), nm == null ? '(no name)' : String.valueOf(nm));
                }
            } catch (Exception e) { /* config missing or field unsafe, fall back to raw Id */ }
            out.put(objectApiName, names);
        }
        return out;
    }

    // --------------------------------------------------------- Pipeline value
    public class StageValue {
        @AuraEnabled public String stage;
        @AuraEnabled public Integer count;
        @AuraEnabled public Double amount;
    }
    public class PipelineValue {
        @AuraEnabled public Double totalAmount;
        @AuraEnabled public Double criticalAmount;
        @AuraEnabled public Double staleAmount;
        @AuraEnabled public Double agingAmount;
        @AuraEnabled public List<StageValue> byStage;
    }

    @AuraEnabled(cacheable=true)
    public static PipelineValue getPipelineValue() {
        SentinelService.Report rep = SentinelService.runCheck('Opportunity', 'all');
        PipelineValue pv = new PipelineValue();
        pv.totalAmount = 0; pv.criticalAmount = 0; pv.staleAmount = 0; pv.agingAmount = 0;
        Map<String, StageValue> byStage = new Map<String, StageValue>();

        for (SentinelService.RecordInfo ri : rep.records) {
            Double amt = ri.amount == null ? 0 : ri.amount;
            pv.totalAmount += amt;
            if (ri.band == 'Critical') { pv.criticalAmount += amt; }
            else if (ri.band == 'Stale') { pv.staleAmount += amt; }
            else { pv.agingAmount += amt; }

            String stageKey = ri.priority == null ? '(none)' : ri.priority;
            if (!byStage.containsKey(stageKey)) {
                StageValue sv = new StageValue();
                sv.stage = stageKey; sv.count = 0; sv.amount = 0;
                byStage.put(stageKey, sv);
            }
            StageValue sv = byStage.get(stageKey);
            sv.count += 1;
            sv.amount += amt;
        }
        pv.byStage = byStage.values();
        return pv;
    }

    // ----------------------------------------------------------- Single-thread
    @AuraEnabled(cacheable=true)
    public static List<SentinelService.RecordInfo> getSingleThreaded() {
        SentinelService.Report rep = SentinelService.runCheck('Opportunity', 'all');
        List<SentinelService.RecordInfo> out = new List<SentinelService.RecordInfo>();
        for (SentinelService.RecordInfo ri : rep.records) {
            if (ri.isSingleThreaded == true) { out.add(ri); }
        }
        return out;
    }

    // ---------------------------------------------------------- Activity gaps
    public class ActivityGaps {
        @AuraEnabled public String objectApiName;
        @AuraEnabled public String label;
        @AuraEnabled public Integer neverContactedCount;
        @AuraEnabled public Integer wentColdCount;
        @AuraEnabled public List<SentinelService.RecordInfo> neverContacted;
        @AuraEnabled public List<SentinelService.RecordInfo> wentCold;
    }

    @AuraEnabled(cacheable=true)
    public static List<ActivityGaps> getActivityGaps() {
        List<ActivityGaps> out = new List<ActivityGaps>();
        for (Sentinel_Config__mdt cfg : SentinelService.getActiveConfigs()) {
            SentinelService.Report rep = SentinelService.runCheck(cfg, 'all');
            ActivityGaps ag = new ActivityGaps();
            ag.objectApiName = rep.objectApiName;
            ag.label = rep.label;
            ag.neverContacted = new List<SentinelService.RecordInfo>();
            ag.wentCold = new List<SentinelService.RecordInfo>();
            for (SentinelService.RecordInfo ri : rep.records) {
                if (String.isBlank(ri.lastActivitySubject)) { ag.neverContacted.add(ri); }
                else { ag.wentCold.add(ri); }
            }
            ag.neverContactedCount = ag.neverContacted.size();
            ag.wentColdCount = ag.wentCold.size();
            out.add(ag);
        }
        return out;
    }
}
