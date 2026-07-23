/**
 * Write-back action: logs a completed activity today on a comma-separated list
 * of record Ids, the conversational equivalent of "log that I called them
 * today." Resets each record's staleness clock. Fronted by Sentinel_LogActivity.
 */
public with sharing class SentinelLogActivityAction {

    public class Request {
        @InvocableVariable(required=true) public String recordIds;
        @InvocableVariable public String note; // Task subject; defaults below
    }
    public class Result {
        @InvocableVariable public Integer loggedCount;
        @InvocableVariable public String message;
    }

    @InvocableMethod(label='Log Activity' description='Logs a completed activity today on the given records, resetting their staleness clock')
    public static List<Result> log(List<Request> reqs) {
        List<Result> out = new List<Result>();
        for (Request req : reqs) {
            String subject = String.isBlank(req.note) ? 'Logged via Sentinel' : req.note;
            List<Task> tasks = new List<Task>();
            for (Id rid : SentinelService.parseIds(req.recordIds)) {
                Task t = new Task(
                    Subject = subject,
                    Status = 'Completed',
                    Priority = 'Normal',
                    ActivityDate = Date.today()
                );
                if (rid.getSObjectType() == Lead.SObjectType) {
                    t.WhoId = rid;
                } else {
                    t.WhatId = rid;
                }
                tasks.add(t);
            }
            if (!tasks.isEmpty()) { insert tasks; }
            Result r = new Result();
            r.loggedCount = tasks.size();
            r.message = 'Logged an activity on ' + tasks.size() + ' record(s).';
            out.add(r);
        }
        return out;
    }
}
