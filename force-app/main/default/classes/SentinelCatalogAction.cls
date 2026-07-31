/**
 * Self-describing action: lists what Sentinel watches and the rule for each object.
 * Lets the Catalog subagent answer "what can you check?" without guessing.
 * Fronted by the Sentinel_Catalog flow.
 */
public with sharing class SentinelCatalogAction {

    public class Request {
        @InvocableVariable
        public String includeInactive; // 'true' to also list inactive configs
    }
    public class Result {
        @InvocableVariable public String catalogJson;
        @InvocableVariable public Integer objectCount;
    }

    @InvocableMethod(label='List Watched Objects' description='Lists the objects Sentinel watches and their staleness rules')
    public static List<Result> getCatalog(List<Request> reqs) {
        Boolean includeInactive = reqs != null && !reqs.isEmpty() &&
            'true'.equalsIgnoreCase(reqs[0].includeInactive);
        List<Sentinel_Config__mdt> configs = includeInactive
            ? [
                SELECT Label__c, Object_API_Name__c, Date_Field__c, Stale_Days__c,
                       Priority_Field__c, Threshold_Alert__c
                FROM Sentinel_Config__mdt
                WITH USER_MODE
                ORDER BY Label__c
              ]
            : SentinelService.getActiveConfigs();

        List<Map<String, Object>> items = new List<Map<String, Object>>();
        for (Sentinel_Config__mdt cfg : configs) {
            items.add(new Map<String, Object>{
                'label' => cfg.Label__c,
                'objectApiName' => cfg.Object_API_Name__c,
                'dateField' => cfg.Date_Field__c,
                'staleDays' => cfg.Stale_Days__c == null ? null : Integer.valueOf(cfg.Stale_Days__c),
                'priorityField' => cfg.Priority_Field__c,
                'thresholdAlert' => cfg.Threshold_Alert__c == null ? null : Integer.valueOf(cfg.Threshold_Alert__c)
            });
        }
        Result r = new Result();
        r.catalogJson = JSON.serialize(items);
        r.objectCount = items.size();
        return new List<Result>{ r };
    }
}
