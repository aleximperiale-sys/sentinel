/**
 * Compares today's live at-risk counts against the most recent prior
 * Sentinel_Snapshot__c row (written daily by SentinelMonitor) so the agent can
 * answer "what changed since yesterday" instead of only ever showing a snapshot.
 * Fronted by the Sentinel_WhatChanged flow.
 */
public with sharing class SentinelWhatChangedAction {

    public class Request {
        @InvocableVariable public String objectApiName; // optional; blank = every active config
    }
    public class Result {
        @InvocableVariable public String deltaJson;
        @InvocableVariable public String message;
    }

    @InvocableMethod(label='What Changed' description='Compares today\'s at-risk counts to the last recorded snapshot')
    public static List<Result> check(List<Request> reqs) {
        List<Result> out = new List<Result>();
        for (Request req : reqs) {
            List<Sentinel_Config__mdt> configs = String.isBlank(req.objectApiName)
                ? SentinelService.getActiveConfigs()
                : new List<Sentinel_Config__mdt>{ SentinelService.getConfig(req.objectApiName) };

            List<Map<String, Object>> deltas = new List<Map<String, Object>>();
            List<String> lines = new List<String>();

            for (Sentinel_Config__mdt cfg : configs) {
                SentinelService.Report rep = SentinelService.runCheck(cfg, 'all');
                List<Sentinel_Snapshot__c> prior = [
                    SELECT Stale_Count__c, Critical_Count__c, Snapshot_Date__c
                    FROM Sentinel_Snapshot__c
                    WHERE Object_API_Name__c = :cfg.Object_API_Name__c AND Snapshot_Date__c < TODAY
                    WITH USER_MODE
                    ORDER BY Snapshot_Date__c DESC LIMIT 1
                ];

                Integer priorCount = prior.isEmpty() ? null : Integer.valueOf(prior[0].Stale_Count__c);
                Integer delta = priorCount == null ? null : rep.staleCount - priorCount;

                deltas.add(new Map<String, Object>{
                    'objectApiName' => rep.objectApiName,
                    'label' => rep.label,
                    'todayCount' => rep.staleCount,
                    'priorCount' => priorCount,
                    'priorDate' => prior.isEmpty() ? null : prior[0].Snapshot_Date__c,
                    'delta' => delta
                });

                if (delta == null) {
                    lines.add(rep.label + ': ' + rep.staleCount + ' today, no prior snapshot yet.');
                } else if (delta == 0) {
                    lines.add(rep.label + ': unchanged at ' + rep.staleCount + '.');
                } else {
                    lines.add(rep.label + ': ' + (delta > 0 ? '+' : '') + delta + ' (' + priorCount + ' -> ' + rep.staleCount + ').');
                }
            }

            Result r = new Result();
            r.deltaJson = JSON.serialize(deltas);
            r.message = String.join(lines, ' ');
            out.add(r);
        }
        return out;
    }
}
