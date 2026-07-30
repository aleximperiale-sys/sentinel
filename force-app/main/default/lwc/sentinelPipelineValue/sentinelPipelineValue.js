import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { reduceError, percent, compactCurrency, matches } from 'c/sentinelUtils';
import getPipelineValue from '@salesforce/apex/SentinelDashboardController.getPipelineValue';

const SORT_OPTIONS = [
    { label: 'Amount, high to low', value: 'amount-desc' },
    { label: 'Amount, low to high', value: 'amount-asc' },
    { label: 'Deal count, high to low', value: 'count-desc' },
    { label: 'Stage A–Z', value: 'stage-asc' }
];

export default class SentinelPipelineValue extends LightningElement {
    pipeline;
    error;
    errorDetail = '';
    refreshing = false;

    searchTerm = '';
    sortBy = 'amount-desc';
    sortOptions = SORT_OPTIONS;

    _wired;

    @wire(getPipelineValue)
    wiredPipeline(result) {
        this._wired = result;
        if (result.data) {
            this.pipeline = result.data;
            this.error = undefined;
            this.errorDetail = '';
        } else if (result.error) {
            const reduced = reduceError(result.error);
            // eslint-disable-next-line no-console
            console.error('SentinelPipelineValue.getPipelineValue failed', result.error);
            this.error = reduced.friendly;
            this.errorDetail = reduced.detail;
            this.pipeline = undefined;
        }
    }

    // ------------------------------------------------------------------ state
    get hasData() {
        return !!(this.pipeline && (this.pipeline.byStage || []).length);
    }
    get showSkeleton() {
        return !this.pipeline && !this.error;
    }
    get showError() {
        return !!this.error;
    }
    get showEmpty() {
        return !!this.pipeline && !this.hasData;
    }
    get errorMessage() {
        return this.error || '';
    }
    get refreshLabel() {
        return this.refreshing ? 'Refreshing data…' : 'Refresh';
    }

    // ------------------------------------------------------------------- hero
    get totalAmount() {
        return this.pipeline ? this.pipeline.totalAmount || 0 : 0;
    }
    get criticalAmount() {
        return this.pipeline ? this.pipeline.criticalAmount || 0 : 0;
    }
    /* Compact form is used only where space is tight (header readout, toast);
       every exact figure renders through lightning-formatted-number so it picks
       up the org's currency and locale rather than a hardcoded symbol. */
    get readoutValue() {
        return this.hasData ? compactCurrency(this.criticalAmount, '') : '';
    }
    get dealCountText() {
        const deals = (this.pipeline.byStage || []).reduce((sum, s) => sum + (s.count || 0), 0);
        return `${deals} at-risk deal${deals === 1 ? '' : 's'} across ${this.totalStages} stage${
            this.totalStages === 1 ? '' : 's'
        }`;
    }

    get criticalSharePct() {
        return percent(this.criticalAmount, this.totalAmount);
    }
    get criticalShareSeverity() {
        const pct = this.criticalSharePct;
        if (pct >= 40) return 'critical';
        if (pct >= 20) return 'stale';
        if (pct > 0) return 'aging';
        return 'success';
    }

    get bandTotal() {
        return Math.round(this.totalAmount);
    }
    get bandSegments() {
        return this.bandRows.map((b) => ({
            key: b.key,
            label: b.label,
            count: Math.round(b.amount),
            severity: b.severity
        }));
    }
    get bandRows() {
        const p = this.pipeline || {};
        const total = this.totalAmount;
        const rows = [
            { key: 'critical', label: 'Critical', severity: 'critical', amount: p.criticalAmount || 0 },
            { key: 'stale', label: 'Stale', severity: 'stale', amount: p.staleAmount || 0 },
            { key: 'aging', label: 'Aging', severity: 'aging', amount: p.agingAmount || 0 }
        ];
        return rows.map((r) => ({ ...r, shareText: `${percent(r.amount, total)}%` }));
    }

    // ----------------------------------------------------------------- stages
    get totalStages() {
        return this.pipeline && this.pipeline.byStage ? this.pipeline.byStage.length : 0;
    }

    get filteredStages() {
        if (!this.hasData) return [];
        const rows = this.pipeline.byStage.filter((s) => matches(s.stage, this.searchTerm));
        const [field, direction] = this.sortBy.split('-');
        const sorted = [...rows].sort((a, b) => {
            if (field === 'stage') return String(a.stage).localeCompare(String(b.stage));
            if (field === 'count') return (a.count || 0) - (b.count || 0);
            return (a.amount || 0) - (b.amount || 0);
        });
        return direction === 'desc' ? sorted.reverse() : sorted;
    }

    get stageRows() {
        const rows = this.filteredStages;
        const max = Math.max(1, ...rows.map((s) => s.amount || 0));
        return rows.map((s, index) => {
            const amount = s.amount || 0;
            const share = percent(amount, this.totalAmount);
            return {
                key: `${s.stage}-${index}`,
                stage: s.stage,
                amount,
                count: s.count || 0,
                countText: `${s.count || 0} deal${(s.count || 0) === 1 ? '' : 's'}`,
                barStyle: `width:${Math.max(2, Math.round((amount / max) * 100))}%`,
                meterLabel: `${s.stage}: ${Math.round(amount).toLocaleString()} at risk, ${share} percent of the total, ${
                    s.count || 0
                } deals`
            };
        });
    }

    get shownCount() {
        return this.stageRows.length;
    }
    get noMatches() {
        return this.hasData && this.stageRows.length === 0;
    }
    get noMatchMessage() {
        return `No stage name contains "${this.searchTerm}". Clear the search to see all ${this.totalStages} stages.`;
    }

    // ---------------------------------------------------------------- actions
    handleSearch(event) {
        this.searchTerm = event.detail.value;
    }
    handleClearSearch() {
        this.searchTerm = '';
    }
    handleSort(event) {
        this.sortBy = event.detail.value;
    }

    async handleRefresh() {
        if (this.refreshing) return;
        this.refreshing = true;
        try {
            await refreshApex(this._wired);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Pipeline value refreshed',
                    message: `${compactCurrency(this.totalAmount, '')} at risk, ${compactCurrency(
                        this.criticalAmount,
                        ''
                    )} of it critical.`,
                    variant: 'success'
                })
            );
        } catch (e) {
            const reduced = reduceError(e);
            // eslint-disable-next-line no-console
            console.error('SentinelPipelineValue refresh failed', e);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Refresh failed',
                    message: reduced.friendly,
                    variant: 'error',
                    mode: 'sticky'
                })
            );
        } finally {
            this.refreshing = false;
        }
    }
}
