/**
 * Cross-object correlation: given one at-risk record (an Opportunity or Case),
 * resolves its Account and reports the account's other open Cases and open
 * Opportunities, so a stale deal can be read alongside "this account also has
 * two unresolved support cases." Fronted by the Sentinel_AccountContext flow.
 */
public with sharing class SentinelAccountContextAction {

    public class Request {
        @InvocableVariable(required=true) public String recordId;
    }
    public class Result {
        @InvocableVariable public String accountName;
        @InvocableVariable public Integer openCaseCount;
        @InvocableVariable public Integer openOpportunityCount;
        @InvocableVariable public String message;
    }

    @InvocableMethod(label='Get Account Context' description='Given an Opportunity or Case, reports the account\'s other open Cases and Opportunities')
    public static List<Result> context(List<Request> reqs) {
        List<Result> out = new List<Result>();
        for (Request req : reqs) {
            Result r = new Result();
            Id rid;
            try { rid = (Id) req.recordId; } catch (Exception e) { rid = null; }

            Id accountId = resolveAccountId(rid);
            if (accountId == null) {
                r.message = 'That record isn\'t linked to an Account, so there\'s no cross-object context to show.';
                out.add(r);
                continue;
            }

            Account acct = [SELECT Name FROM Account WHERE Id = :accountId LIMIT 1];
            Integer openCases = [SELECT COUNT() FROM Case WHERE AccountId = :accountId AND IsClosed = false];
            Integer openOpps = [SELECT COUNT() FROM Opportunity WHERE AccountId = :accountId AND IsClosed = false];

            r.accountName = acct.Name;
            r.openCaseCount = openCases;
            r.openOpportunityCount = openOpps;
            r.message = acct.Name + ' has ' + openOpps + ' open opportunity(ies) and ' + openCases + ' open case(s) besides this record.';
            out.add(r);
        }
        return out;
    }

    private static Id resolveAccountId(Id rid) {
        if (rid == null) { return null; }
        if (rid.getSObjectType() == Opportunity.SObjectType) {
            List<Opportunity> opps = [SELECT AccountId FROM Opportunity WHERE Id = :rid LIMIT 1];
            return opps.isEmpty() ? null : opps[0].AccountId;
        }
        if (rid.getSObjectType() == Case.SObjectType) {
            List<Case> cases = [SELECT AccountId FROM Case WHERE Id = :rid LIMIT 1];
            return cases.isEmpty() ? null : cases[0].AccountId;
        }
        return null; // Leads and Tasks aren't Account-linked in this model
    }
}
