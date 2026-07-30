import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { reduceError, percent } from 'c/sentinelUtils';
import getActivityGaps from '@salesforce/apex/SentinelDashboardController.getActivityGaps';

const RECORDS_PER_CARD = 5;

const LENS_OPTIONS = [
    { label: 'Both gaps', value: 'both' },
    { label: 'Never contacted', value: 'never' },
    { label: 'Went cold', value: 'cold' }
];

export default class SentinelActivityGaps extends LightningElement {
    gaps;
    error;
    errorDetail = '';
    refreshing = false;

    lens = 'both';
    lensOptions = LENS_OPTIONS;
    expandedKeys = {};

    _wired;

    @wire(getActivityGaps)
    wiredGaps(result) {
        this._wired = result;
        if (result.data) {
            this.gaps = result.data;
            this.error = undefined;
            this.errorDetail = '';
        } else if (result.error) {
            const reduced = reduceError(result.error);
            // eslint-disable-next-line no-console
            console.error('SentinelActivityGaps.getActivityGaps failed', result.error);
            this.error = reduced.friendly;
            this.errorDetail = reduced.detail;
            this.gaps = undefined;
        }
    }

    // ------------------------------------------------------------------ state
    get hasData() {
        return !!(this.gaps && this.gaps.length && this.gapTotal > 0);
    }
    get showSkeleton() {
        return !this.gaps && !this.error;
    }
    get showError() {
        return !!this.error;
    }
    get showEmpty() {
        return !!this.gaps && !this.hasData;
    }
    get errorMessage() {
        return this.error || '';
    }
    get refreshLabel() {
        return this.refreshing ? 'Refreshing data…' : 'Refresh';
    }

    get lensNote() {
        if (this.lens === 'never') return 'Cards are ranked by records that were never worked.';
        if (this.lens === 'cold') return 'Cards are ranked by records that went quiet after being worked.';
        return 'Cards are ranked by total at-risk records.';
    }

    // ------------------------------------------------------------------- hero
    get neverTotal() {
        return (this.gaps || []).reduce((sum, g) => sum + (g.neverContactedCount || 0), 0);
    }
    get coldTotal() {
        return (this.gaps || []).reduce((sum, g) => sum + (g.wentColdCount || 0), 0);
    }
    get gapTotal() {
        return this.neverTotal + this.coldTotal;
    }
    get readoutValue() {
        return this.hasData ? String(this.neverTotal) : '';
    }
    get neverSharePct() {
        return percent(this.neverTotal, this.gapTotal);
    }
    get neverShareSeverity() {
        const pct = this.neverSharePct;
        if (pct >= 50) return 'critical';
        if (pct >= 25) return 'stale';
        if (pct > 0) return 'aging';
        return 'success';
    }
    get neverSupport() {
        if (!this.neverTotal) {
            return `Every one of the ${this.gapTotal} at-risk records has been worked at least once.`;
        }
        return `of ${this.gapTotal} at-risk records have never been touched.`;
    }
    get totalSegments() {
        return [
            { key: 'never', label: 'Never contacted', count: this.neverTotal, severity: 'critical' },
            { key: 'cold', label: 'Went cold', count: this.coldTotal, severity: 'stale' }
        ];
    }

    // ------------------------------------------------------------------ cards
    get cards() {
        if (!this.gaps) return [];
        const built = this.gaps.map((g) => this.buildCard(g));
        return built.sort((a, b) => b.sortValue - a.sortValue);
    }

    buildCard(gap) {
        const never = gap.neverContactedCount || 0;
        const cold = gap.wentColdCount || 0;
        const total = never + cold;
        const expanded = !!this.expandedKeys[gap.objectApiName];

        const focus =
            this.lens === 'never'
                ? { count: never, cap: 'never contacted', sortValue: never }
                : this.lens === 'cold'
                ? { count: cold, cap: 'went cold', sortValue: cold }
                : { count: total, cap: 'at risk', sortValue: total };

        const sources = [];
        if (this.lens !== 'cold') {
            sources.push({ list: gap.neverContacted || [], kind: 'Never contacted', severity: 'critical' });
        }
        if (this.lens !== 'never') {
            sources.push({ list: gap.wentCold || [], kind: 'Went cold', severity: 'stale' });
        }

        const flattened = [];
        sources.forEach((source) => {
            source.list.forEach((r) => {
                flattened.push({
                    id: `${source.kind}-${r.id}`,
                    name: r.name,
                    url: r.url,
                    kind: source.kind,
                    severity: source.severity,
                    ageDays: r.ageDays || 0,
                    ageText: r.ageDays === null || r.ageDays === undefined ? '-' : `${r.ageDays}d`,
                    tooltip: r.lastActivitySubject
                        ? `Last activity: ${r.lastActivitySubject}`
                        : r.explanation || 'No completed activity on record.'
                });
            });
        });
        flattened.sort((a, b) => b.ageDays - a.ageDays);
        const records = flattened.slice(0, RECORDS_PER_CARD);

        return {
            key: gap.objectApiName,
            label: gap.label,
            objectApiName: gap.objectApiName,
            total,
            isClear: total === 0,
            focusCount: focus.count,
            focusCap: focus.cap,
            sortValue: focus.sortValue,
            cardClass: never > cold ? 'gap gap--never' : total > 0 ? 'gap gap--cold' : 'gap',
            segments: [
                { key: 'never', label: 'Never contacted', count: never, severity: 'critical' },
                { key: 'cold', label: 'Went cold', count: cold, severity: 'stale' }
            ],
            hasRecords: records.length > 0,
            records,
            moreCount: Math.max(0, flattened.length - records.length),
            moreText: `${Math.max(0, flattened.length - records.length)} more not shown here`,
            expanded,
            expandedAttr: expanded ? 'true' : 'false',
            toggleIcon: expanded ? 'utility:chevronup' : 'utility:chevrondown',
            toggleLabel: expanded ? 'Hide oldest records' : `Show ${records.length} oldest records`
        };
    }

    // ---------------------------------------------------------------- actions
    handleLensChange(event) {
        this.lens = event.detail.value;
    }

    handleToggle(event) {
        const key = event.currentTarget.dataset.key;
        this.expandedKeys = { ...this.expandedKeys, [key]: !this.expandedKeys[key] };
    }

    async handleRefresh() {
        if (this.refreshing) return;
        this.refreshing = true;
        try {
            await refreshApex(this._wired);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Activity gaps refreshed',
                    message: `${this.neverTotal} never contacted, ${this.coldTotal} went cold.`,
                    variant: 'success'
                })
            );
        } catch (e) {
            const reduced = reduceError(e);
            // eslint-disable-next-line no-console
            console.error('SentinelActivityGaps refresh failed', e);
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
