import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { reduceError, percent } from 'c/sentinelUtils';
import getOverview from '@salesforce/apex/SentinelDashboardController.getOverview';
import getTrends from '@salesforce/apex/SentinelDashboardController.getTrends';

const TREND_WINDOW_DAYS = 7;
const RECORDS_PER_CARD = 5;

const SCOPE_OPTIONS = [
    { label: 'All owners', value: 'all' },
    { label: 'Mine', value: 'mine' }
];

export default class SentinelDashboard extends LightningElement {
    scope = 'all';
    refreshing = false;

    overview;
    error;
    errorDetail = '';

    /** objectApiName -> snapshot points, used for the real 7-day delta. */
    trendsByObject = {};

    _overviewWire;
    _trendsWire;

    scopeOptions = SCOPE_OPTIONS;

    // ------------------------------------------------------------------ wires
    @wire(getOverview, { ownerScope: '$scope' })
    wiredOverview(result) {
        this._overviewWire = result;
        if (result.data) {
            this.overview = result.data;
            this.error = undefined;
            this.errorDetail = '';
        } else if (result.error) {
            const reduced = reduceError(result.error);
            // Keep the raw platform error for developers, show the sentence to users.
            // eslint-disable-next-line no-console
            console.error('SentinelDashboard.getOverview failed', result.error);
            this.error = reduced.friendly;
            this.errorDetail = reduced.detail;
            this.overview = undefined;
        }
    }

    @wire(getTrends, { daysBack: TREND_WINDOW_DAYS })
    wiredTrends(result) {
        this._trendsWire = result;
        if (result.data) {
            const map = {};
            result.data.forEach((t) => {
                map[t.objectApiName] = t.points || [];
            });
            this.trendsByObject = map;
        } else if (result.error) {
            // Trend history is enrichment, not the point of the page: degrade quietly.
            // eslint-disable-next-line no-console
            console.warn('SentinelDashboard.getTrends unavailable', result.error);
            this.trendsByObject = {};
        }
    }

    // ------------------------------------------------------------------ state
    get hasData() {
        return !!(this.overview && this.overview.objects && this.overview.objects.length);
    }
    get showSkeleton() {
        return !this.overview && !this.error;
    }
    get showError() {
        return !!this.error;
    }
    get showEmpty() {
        return !!this.overview && !this.hasData;
    }
    get errorMessage() {
        return this.error || '';
    }
    get refreshLabel() {
        return this.refreshing ? 'Refreshing data…' : 'Refresh';
    }

    get scopeNote() {
        return this.scope === 'mine'
            ? 'Showing only records you own.'
            : 'Showing records owned by anyone.';
    }
    get emptyTitle() {
        return this.scope === 'mine' ? 'Your records are all current' : 'Every watched object is clear';
    }
    get emptyMessage() {
        return this.scope === 'mine'
            ? 'None of the records you own has been idle past its threshold.'
            : 'No active Sentinel configuration returned an at-risk record. Either the pipeline is genuinely clean, or no configuration is active yet.';
    }

    // ------------------------------------------------------------------ hero
    get total() {
        return this.overview ? this.overview.totalAtRisk || 0 : 0;
    }
    get criticalTotal() {
        return this.overview ? this.overview.critical || 0 : 0;
    }
    get objectCount() {
        return this.overview ? this.overview.objectCount || 0 : 0;
    }
    get readoutValue() {
        return this.hasData ? String(this.criticalTotal) : '';
    }

    get criticalSharePct() {
        return percent(this.criticalTotal, this.total);
    }
    get criticalShareSeverity() {
        const pct = this.criticalSharePct;
        if (pct >= 40) return 'critical';
        if (pct >= 20) return 'stale';
        if (pct > 0) return 'aging';
        return 'success';
    }
    get gaugeCaption() {
        return `of ${this.total} at-risk records are past 3× their threshold`;
    }
    get criticalSupport() {
        if (!this.criticalTotal) {
            return `Nothing is past 3× its threshold, across ${this.total} at-risk records.`;
        }
        return `of ${this.total} at-risk records need attention today.`;
    }

    get aggregateBands() {
        const objects = this.hasData ? this.overview.objects : [];
        const sum = (field) => objects.reduce((acc, o) => acc + (o[field] || 0), 0);
        return [
            { key: 'aging', label: 'Aging', count: sum('aging'), severity: 'aging' },
            { key: 'stale', label: 'Stale', count: sum('stale'), severity: 'stale' },
            { key: 'critical', label: 'Critical', count: sum('critical'), severity: 'critical' }
        ];
    }

    get worstObjectLabel() {
        if (!this.hasData) return '-';
        const worst = [...this.overview.objects].sort(
            (a, b) => (b.critical || 0) - (a.critical || 0) || (b.staleCount || 0) - (a.staleCount || 0)
        )[0];
        return worst ? worst.label : '-';
    }

    /** Total at-risk change over the trend window, only for objects with history. */
    get overallTrend() {
        const keys = Object.keys(this.trendsByObject);
        if (!keys.length) return null;
        let delta = 0;
        let covered = 0;
        keys.forEach((key) => {
            const points = this.trendsByObject[key];
            if (points && points.length >= 2) {
                delta += (points[points.length - 1].staleCount || 0) - (points[0].staleCount || 0);
                covered += 1;
            }
        });
        if (!covered) return null;
        return this.buildTrend(delta, `vs ${TREND_WINDOW_DAYS} days ago`, 'at-risk records ');
    }

    get overallTrendClass() {
        const trend = this.overallTrend;
        return `hero__trend hero__trend--${trend ? trend.severity : 'neutral'}`;
    }

    // ------------------------------------------------------------------ cards
    get cards() {
        if (!this.hasData) return [];
        return this.overview.objects.map((o) => {
            const staleCount = o.staleCount || 0;
            const bands = [
                { key: 'aging', label: 'Aging', count: o.aging || 0, severity: 'aging' },
                { key: 'stale', label: 'Stale', count: o.stale || 0, severity: 'stale' },
                { key: 'critical', label: 'Critical', count: o.critical || 0, severity: 'critical' }
            ];

            const records = (o.records || []).slice(0, RECORDS_PER_CARD).map((r) => ({
                id: r.id,
                name: r.name,
                url: r.url,
                band: r.band,
                severity: String(r.band || 'neutral').toLowerCase(),
                ageText: r.ageDays === null || r.ageDays === undefined ? '-' : `${r.ageDays}d`,
                explanation: r.explanation
            }));

            return {
                key: o.objectApiName,
                label: o.label,
                objectApiName: o.objectApiName,
                staleCount,
                thresholdDays: o.thresholdDays,
                severity: this.dominantSeverity(o),
                bands,
                owners: (o.topOwners || []).slice(0, 1),
                trend: this.objectTrend(o.objectApiName),
                records,
                moreCount: Math.max(0, staleCount - records.length)
            };
        });
    }

    dominantSeverity(o) {
        if (!o.staleCount) return 'success';
        if ((o.critical || 0) > 0 && (o.critical || 0) >= (o.stale || 0) && (o.critical || 0) >= (o.aging || 0)) {
            return 'critical';
        }
        if ((o.stale || 0) > 0 && (o.stale || 0) >= (o.aging || 0)) return 'stale';
        return 'aging';
    }

    objectTrend(objectApiName) {
        const points = this.trendsByObject[objectApiName];
        if (!points || points.length < 2) return null;
        const delta = (points[points.length - 1].staleCount || 0) - (points[0].staleCount || 0);
        return this.buildTrend(delta, `vs ${TREND_WINDOW_DAYS} days ago`, '');
    }

    /** More at-risk records is worse; fewer is better. Direction is spelled out. */
    buildTrend(delta, note, unit) {
        if (delta > 0) {
            return {
                direction: 'increase',
                icon: 'utility:arrowup',
                severity: 'critical',
                text: `+${delta} ${unit}`.trim(),
                note
            };
        }
        if (delta < 0) {
            return {
                direction: 'decrease',
                icon: 'utility:arrowdown',
                severity: 'success',
                text: `${delta} ${unit}`.trim(),
                note
            };
        }
        return { direction: 'no change', icon: 'utility:dash', severity: 'neutral', text: 'No change', note };
    }

    // ---------------------------------------------------------------- actions
    handleScopeChange(event) {
        this.scope = event.detail.value;
    }

    async handleRefresh() {
        if (this.refreshing) return;
        this.refreshing = true;
        try {
            await Promise.all([refreshApex(this._overviewWire), refreshApex(this._trendsWire)]);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Record health refreshed',
                    message: `${this.criticalTotal} critical of ${this.total} at-risk records.`,
                    variant: 'success'
                })
            );
        } catch (e) {
            const reduced = reduceError(e);
            // eslint-disable-next-line no-console
            console.error('SentinelDashboard refresh failed', e);
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
