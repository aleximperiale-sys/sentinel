/**
 * Cross-object rollup, runs every active config in one call and returns a
 * combined summary. Fronted by the Sentinel_Rollup flow for the agent and
 * reused by the dashboard's "everything at-risk" view.
 */
public with sharing class SentinelRollupAction {

    public class Request {
        @InvocableVariable
        public String ownerScope; // 'mine' or 'all'
    }

    public class Result {
        @InvocableVariable public String rollupJson;
        @InvocableVariable public Integer totalCount;
        @InvocableVariable public Integer objectCount;
    }

    @InvocableMethod(label='Check All Record Health' description='Runs staleness checks across every active configured object')
    public static List<Result> check(List<Request> requests) {
        String scope = 'all';
        if (requests != null && !requests.isEmpty() && String.isNotBlank(requests[0].ownerScope)) {
            scope = requests[0].ownerScope.toLowerCase();
        }

        List<Map<String, Object>> objects = new List<Map<String, Object>>();
        Integer total = 0;
        for (Sentinel_Config__mdt cfg : SentinelService.getActiveConfigs()) {
            SentinelService.Report rep = SentinelService.runCheck(cfg, scope);
            total += rep.staleCount;
            objects.add(new Map<String, Object>{
                'objectApiName' => rep.objectApiName,
                'label' => rep.label,
                'staleCount' => rep.staleCount,
                'thresholdDays' => rep.thresholdDays,
                'byBand' => rep.summary.byBand,
                'topOwners' => rep.summary.byOwner,
                'records' => rep.records
            });
        }

        Result r = new Result();
        r.totalCount = total;
        r.objectCount = objects.size();
        r.rollupJson = JSON.serialize(objects);
        return new List<Result>{ r };
    }
}
