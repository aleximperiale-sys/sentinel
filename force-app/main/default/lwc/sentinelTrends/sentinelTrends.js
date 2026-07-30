import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { reduceError } from 'c/sentinelUtils';
import getTrends from '@salesforce/apex/SentinelDashboardController.getTrends';

/* Plot geometry, kept here so the SVG stays declarative. */
const X_LEFT = 8;
const X_RIGHT = 312;
const Y_BASE = 100;
const Y_TOP = 12;

const RANGE_OPTIONS = [
    { label: '7 days', value: '7' },
    { label: '14 days', value: '14' },
    { label: '30 days', value: '30' }
];

export default class SentinelTrends extends LightningElement {
    trends;
    error;
    errorDetail = '';
    refreshing = false;

    rangeValue = '14';
    rangeOptions = RANGE_OPTIONS;

    /* daysBack must be a reactive field, not a getter: the `$` wire syntax only
       re-invokes when the named property itself is reassigned. */
    daysBack = 14;

    /** objectApiName -> whether its data table is expanded. */
    expandedKeys = {};

    _wired;

    @wire(getTrends, { daysBack: '$daysBack' })
    wiredTrends(result) {
        this._wired = result;
        if (result.data) {
            this.trends = result.data;
            this.error = undefined;
            this.errorDetail = '';
        } else if (result.error) {
            const reduced = reduceError(result.error);
            // eslint-disable-next-line no-console
            console.error('SentinelTrends.getTrends failed', result.error);
            this.error = reduced.friendly;
            this.errorDetail = reduced.detail;
            this.trends = undefined;
        }
    }

    // ------------------------------------------------------------------ state
    get hasData() {
        return !!(this.trends && this.trends.length);
    }
    get showSkeleton() {
        return !this.trends && !this.error;
    }
    get showError() {
        return !!this.error;
    }
    get showEmpty() {
        return !!this.trends && !this.hasData;
    }
    get errorMessage() {
        return this.error || '';
    }
    get refreshLabel() {
        return this.refreshing ? 'Refreshing data…' : 'Refresh';
    }
    get rangeNote() {
        return `Showing snapshots from the last ${this.daysBack} days.`;
    }

    /** Net movement across every object with at least two snapshots. */
    get readoutValue() {
        if (!this.hasData) return '';
        let delta = 0;
        let covered = 0;
        this.trends.forEach((t) => {
            const points = t.points || [];
            if (points.length >= 2) {
                delta += (points[points.length - 1].staleCount || 0) - (points[0].staleCount || 0);
                covered += 1;
            }
        });
        if (!covered) return 'n/a';
        if (delta > 0) return `+${delta}`;
        if (delta < 0) return String(delta);
        return 'flat';
    }

    // ------------------------------------------------------------------- rows
    get rows() {
        if (!this.hasData) return [];
        return this.trends.map((t) => this.buildRow(t));
    }

    buildRow(trend) {
        const points = trend.points || [];
        const hasSeries = points.length >= 2;
        const latest = points.length ? points[points.length - 1] : null;
        const latestStale = latest ? latest.staleCount || 0 : 0;
        const latestCritical = latest ? latest.criticalCount || 0 : 0;
        const expanded = !!this.expandedKeys[trend.objectApiName];

        const base = {
            key: trend.objectApiName,
            label: trend.label,
            objectApiName: trend.objectApiName,
            hasSeries,
            latestStale,
            latestCritical,
            expanded,
            expandedAttr: expanded ? 'true' : 'false',
            toggleIcon: expanded ? 'utility:chevronup' : 'utility:chevrondown',
            toggleLabel: expanded ? 'Hide daily figures' : 'Show daily figures',
            cardClass: 'chart',
            delta: null
        };

        if (!hasSeries) {
            return base;
        }

        const axisMax = Math.max(
            1,
            ...points.map((p) => Math.max(p.staleCount || 0, p.criticalCount || 0))
        );
        const stepX = points.length > 1 ? (X_RIGHT - X_LEFT) / (points.length - 1) : 0;
        const yFor = (value) => Y_BASE - ((value || 0) / axisMax) * (Y_BASE - Y_TOP);
        const round = (n) => Math.round(n * 10) / 10;

        const staleCoords = points.map((p, i) => `${round(X_LEFT + i * stepX)},${round(yFor(p.staleCount))}`);
        const criticalCoords = points.map(
            (p, i) => `${round(X_LEFT + i * stepX)},${round(yFor(p.criticalCount))}`
        );

        const delta = latestStale - (points[0].staleCount || 0);

        return {
            ...base,
            cardClass: delta > 0 ? 'chart chart--worse' : delta < 0 ? 'chart chart--better' : 'chart',
            axisMax,
            staleLine: staleCoords.join(' '),
            criticalLine: criticalCoords.join(' '),
            areaPoints: `${X_LEFT},${Y_BASE} ${staleCoords.join(' ')} ${X_RIGHT},${Y_BASE}`,
            gridLines: [Y_BASE, 78, 56, 34, Y_TOP].map((y) => ({ key: `g-${y}`, y })),
            lastX: round(X_LEFT + (points.length - 1) * stepX),
            lastStaleY: round(yFor(latestStale)),
            lastCriticalY: round(yFor(latestCritical)),
            firstDate: points[0].snapshotDate,
            lastDate: latest.snapshotDate,
            delta: this.buildDelta(delta),
            ariaLabel: this.buildAriaLabel(trend.label, points, axisMax, delta),
            tableRows: points.map((p, i) => ({
                key: `${trend.objectApiName}-${i}`,
                date: p.snapshotDate,
                stale: p.staleCount || 0,
                critical: p.criticalCount || 0
            }))
        };
    }

    buildDelta(delta) {
        if (delta > 0) {
            return {
                severity: 'critical',
                label: `Worsening +${delta}`,
                tooltip: `${delta} more at-risk records than the oldest snapshot in this range.`
            };
        }
        if (delta < 0) {
            return {
                severity: 'success',
                label: `Improving ${delta}`,
                tooltip: `${Math.abs(delta)} fewer at-risk records than the oldest snapshot in this range.`
            };
        }
        return { severity: 'neutral', label: 'Flat', tooltip: 'No net change across this range.' };
    }

    /* Text alternative for the hand-rolled SVG; the expandable table carries the
       full series for anyone who needs the exact figures. */
    buildAriaLabel(label, points, axisMax, delta) {
        const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
        return `${label}: at-risk trend over ${points.length} snapshots, from ${
            points[0].staleCount || 0
        } to ${points[points.length - 1].staleCount || 0} records, ${direction} by ${Math.abs(
            delta
        )}. Peak ${axisMax}. Expand "Show daily figures" for the full table.`;
    }

    // ---------------------------------------------------------------- actions
    handleRangeChange(event) {
        this.rangeValue = event.detail.value;
        this.daysBack = parseInt(this.rangeValue, 10);
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
                    title: 'Trends refreshed',
                    message: `Snapshot history for the last ${this.daysBack} days.`,
                    variant: 'success'
                })
            );
        } catch (e) {
            const reduced = reduceError(e);
            // eslint-disable-next-line no-console
            console.error('SentinelTrends refresh failed', e);
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
