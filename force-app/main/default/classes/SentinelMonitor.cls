/**
 * SentinelMonitor, scheduled proactive sweep. Runs every active config, posts a
 * digest to the running user's Chatter feed, and raises a custom notification for
 * any config whose stale count meets or exceeds its Threshold_Alert__c.
 *
 * Schedule with:
 *   System.schedule('Sentinel Daily Monitor', '0 0 7 * * ?', new SentinelMonitor());
 */
public with sharing class SentinelMonitor implements Schedulable {

    public void execute(SchedulableContext sc) {
        run();
    }

    public static Integer run() {
        return run(SentinelService.getActiveConfigs());
    }

    public static Integer run(List<Sentinel_Config__mdt> configs) {
        List<String> lines = new List<String>();
        List<Messaging.CustomNotification> notes = new List<Messaging.CustomNotification>();
        List<Sentinel_Snapshot__c> snapshots = new List<Sentinel_Snapshot__c>();
        Map<String, Sentinel_Snapshot__c> priorSnapshots = getPriorSnapshots(configs);
        Set<Id> managerTargets = new Set<Id>();
        Id notifTypeId = getNotificationTypeId();
        Id me = UserInfo.getUserId();
        Integer grandTotal = 0;

        for (Sentinel_Config__mdt cfg : configs) {
            SentinelService.Report rep = SentinelService.runCheck(cfg, 'all');
            grandTotal += rep.staleCount;
            lines.add(rep.label + ' (' + rep.objectApiName + '): ' + rep.staleCount + ' at-risk');

            Integer criticalCount = bandCount(rep, 'Critical');
            snapshots.add(new Sentinel_Snapshot__c(
                Object_API_Name__c = rep.objectApiName,
                Label__c = rep.label,
                Snapshot_Date__c = Date.today(),
                Stale_Count__c = rep.staleCount,
                Critical_Count__c = criticalCount
            ));

            if (cfg.Threshold_Alert__c != null && rep.staleCount >= cfg.Threshold_Alert__c && notifTypeId != null) {
                Messaging.CustomNotification n = new Messaging.CustomNotification();
                n.setTitle('Sentinel: ' + rep.label + ' needs attention');
                n.setBody(rep.staleCount + ' ' + rep.label + ' records are at-risk (threshold ' +
                    Integer.valueOf(cfg.Threshold_Alert__c) + ').');
                n.setNotificationTypeId(notifTypeId);
                n.setTargetId(me);
                notes.add(n);
            }

            // Escalate to managers when Critical volume has met threshold two days running.
            Sentinel_Snapshot__c prior = priorSnapshots.get(rep.objectApiName);
            Boolean persistedCritical = cfg.Threshold_Alert__c != null && criticalCount >= cfg.Threshold_Alert__c
                && prior != null && prior.Critical_Count__c != null && prior.Critical_Count__c >= cfg.Threshold_Alert__c;
            if (persistedCritical) {
                managerTargets.addAll(getManagerIdsForCriticalOwners(rep));
            }
        }

        upsertSnapshots(snapshots);

        try {
            insert new FeedItem(
                ParentId = me,
                Body = 'Sentinel daily health digest, ' + grandTotal + ' records at-risk\n' +
                    String.join(lines, '\n')
            );
        } catch (Exception e) {
            // Chatter may be disabled in the org; the digest is best-effort.
        }

        for (Messaging.CustomNotification n : notes) {
            try { n.send(new Set<String>{ String.valueOf(me) }); } catch (Exception e) { /* best-effort */ }
        }

        if (!managerTargets.isEmpty() && notifTypeId != null) {
            Messaging.CustomNotification esc = new Messaging.CustomNotification();
            esc.setTitle('Sentinel: escalation');
            esc.setBody('One or more of your reports has Critical records that have stayed at or above threshold for two days running.');
            esc.setNotificationTypeId(notifTypeId);
            try {
                Set<String> targets = new Set<String>();
                for (Id t : managerTargets) { targets.add(String.valueOf(t)); }
                esc.send(targets);
            } catch (Exception e) { /* best-effort */ }
        }

        return grandTotal;
    }

    private static Integer bandCount(SentinelService.Report rep, String bandKey) {
        for (SentinelService.GroupCount gc : rep.summary.byBand) {
            if (gc.key == bandKey) { return gc.count; }
        }
        return 0;
    }

    private static Map<String, Sentinel_Snapshot__c> getPriorSnapshots(List<Sentinel_Config__mdt> configs) {
        Set<String> objectNames = new Set<String>();
        for (Sentinel_Config__mdt cfg : configs) { objectNames.add(cfg.Object_API_Name__c); }
        Map<String, Sentinel_Snapshot__c> out = new Map<String, Sentinel_Snapshot__c>();
        if (objectNames.isEmpty()) { return out; }
        for (Sentinel_Snapshot__c s : [
            SELECT Object_API_Name__c, Critical_Count__c, Snapshot_Date__c
            FROM Sentinel_Snapshot__c
            WHERE Object_API_Name__c IN :objectNames AND Snapshot_Date__c < TODAY
            ORDER BY Snapshot_Date__c DESC
        ]) {
            if (!out.containsKey(s.Object_API_Name__c)) { out.put(s.Object_API_Name__c, s); } // first = most recent
        }
        return out;
    }

    private static void upsertSnapshots(List<Sentinel_Snapshot__c> today) {
        if (today.isEmpty()) { return; }
        Set<String> objectNames = new Set<String>();
        for (Sentinel_Snapshot__c s : today) { objectNames.add(s.Object_API_Name__c); }
        Map<String, Id> existingIds = new Map<String, Id>();
        for (Sentinel_Snapshot__c s : [
            SELECT Id, Object_API_Name__c FROM Sentinel_Snapshot__c
            WHERE Object_API_Name__c IN :objectNames AND Snapshot_Date__c = TODAY
        ]) {
            existingIds.put(s.Object_API_Name__c, s.Id);
        }
        for (Sentinel_Snapshot__c s : today) {
            if (existingIds.containsKey(s.Object_API_Name__c)) { s.Id = existingIds.get(s.Object_API_Name__c); }
        }
        upsert today;
    }

    private static Set<Id> getManagerIdsForCriticalOwners(SentinelService.Report rep) {
        Set<Id> ownerIds = new Set<Id>();
        for (SentinelService.RecordInfo ri : rep.records) {
            if (ri.band == 'Critical' && ri.ownerId != null) {
                try { ownerIds.add((Id) ri.ownerId); } catch (Exception e) { /* not a User id; skip */ }
            }
        }
        Set<Id> managers = new Set<Id>();
        if (ownerIds.isEmpty()) { return managers; }
        for (User u : [SELECT ManagerId FROM User WHERE Id IN :ownerIds AND ManagerId != null]) {
            managers.add(u.ManagerId);
        }
        return managers;
    }

    private static Id getNotificationTypeId() {
        List<CustomNotificationType> types = [
            SELECT Id FROM CustomNotificationType WHERE DeveloperName = 'Sentinel_Alert' LIMIT 1
        ];
        return types.isEmpty() ? null : types[0].Id;
    }
}
