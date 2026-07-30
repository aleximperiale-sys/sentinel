import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { reduceError, percent, matches } from 'c/sentinelUtils';
import getLeaderboard from '@salesforce/apex/SentinelDashboardController.getLeaderboard';

const PAGE_SIZE = 15;

const SORT_OPTIONS = [
    { label: 'Rank, most at risk', value: 'count-desc' },
    { label: 'Least at risk', value: 'count-asc' },
    { label: 'Owner A–Z', value: 'owner-asc' },
    { label: 'Owner Z–A', value: 'owner-desc' }
];

export default class SentinelLeaderboard extends LightningElement {
    leaderboard;
    error;
    errorDetail = '';
    refreshing = false;

    searchTerm = '';
    sortBy = 'count-desc';
    pageSize = PAGE_SIZE;

    sortOptions = SORT_OPTIONS;

    _wired;

    @wire(getLeaderboard, { objectApiName: null })
    wiredLeaderboard(result) {
        this._wired = result;
        if (result.data) {
            this.leaderboard = result.data;
            this.error = undefined;
            this.errorDetail = '';
        } else if (result.error) {
            const reduced = reduceError(result.error);
            // eslint-disable-next-line no-console
            console.error('SentinelLeaderboard.getLeaderboard failed', result.error);
            this.error = reduced.friendly;
            this.errorDetail = reduced.detail;
            this.leaderboard = undefined;
        }
    }

    // ------------------------------------------------------------------ state
    get hasData() {
        return !!(this.leaderboard && this.leaderboard.length);
    }
    get showSkeleton() {
        return !this.leaderboard && !this.error;
    }
    get showError() {
        return !!this.error;
    }
    get showEmpty() {
        return !!this.leaderboard && !this.hasData;
    }
    get errorMessage() {
        return this.error || '';
    }
    get refreshLabel() {
        return this.refreshing ? 'Refreshing data…' : 'Refresh';
    }

    get total() {
        return this.hasData ? this.leaderboard.reduce((sum, g) => sum + (g.count || 0), 0) : 0;
    }
    get totalOwners() {
        return this.hasData ? this.leaderboard.length : 0;
    }
    get readoutValue() {
        return this.hasData ? String(this.total) : '';
    }

    /** Share carried by the top three owners, the number a manager acts on. */
    get concentrationText() {
        if (!this.hasData) return '-';
        const ranked = [...this.leaderboard].sort((a, b) => (b.count || 0) - (a.count || 0));
        const topThree = ranked.slice(0, 3).reduce((sum, g) => sum + (g.count || 0), 0);
        const share = percent(topThree, this.total);
        const names = ranked.slice(0, 3).length;
        return `Top ${names} owner${names === 1 ? '' : 's'} hold ${share}% of all at-risk records`;
    }

    // ------------------------------------------------------------------- rows
    /** Rank is always assigned by count, independent of the display sort. */
    get rankedRows() {
        if (!this.hasData) return [];
        const byCount = [...this.leaderboard].sort(
            (a, b) => (b.count || 0) - (a.count || 0) || String(a.key).localeCompare(String(b.key))
        );
        const max = Math.max(1, ...byCount.map((g) => g.count || 0));
        const total = this.total;

        return byCount.map((g, index) => {
            const count = g.count || 0;
            const share = percent(count, total);
            const rank = index + 1;
            const severity = this.severityForShare(share);
            return {
                key: `${g.key}-${rank}`,
                rank,
                rankText: `Rank ${rank} of ${byCount.length}`,
                owner: g.key,
                count,
                share,
                shareText: `${share}% of all at-risk records`,
                barStyle: `width:${Math.max(2, Math.round((count / max) * 100))}%`,
                meterLabel: `${g.key}: ${count} at-risk records, ${share} percent of the total`,
                rowClass: rank <= 3 ? `board__row board__row--podium board__row--p${rank}` : 'board__row',
                rankClass: rank <= 3 ? `board__rank board__rank--p${rank}` : 'board__rank',
                severity: severity.key,
                severityLabel: severity.label,
                severityTooltip: severity.tooltip
            };
        });
    }

    severityForShare(share) {
        if (share >= 30) {
            return {
                key: 'critical',
                label: 'Overloaded',
                tooltip: 'This owner holds 30% or more of all at-risk records.'
            };
        }
        if (share >= 15) {
            return { key: 'stale', label: 'Heavy', tooltip: 'This owner holds 15% or more of all at-risk records.' };
        }
        return { key: 'neutral', label: 'Normal', tooltip: 'Below 15% of all at-risk records.' };
    }

    get filteredRows() {
        const term = this.searchTerm;
        const rows = this.rankedRows.filter((r) => matches(r.owner, term));
        const [field, direction] = this.sortBy.split('-');
        const sorted = [...rows].sort((a, b) => {
            if (field === 'owner') return String(a.owner).localeCompare(String(b.owner));
            return (a.count || 0) - (b.count || 0);
        });
        return direction === 'desc' ? sorted.reverse() : sorted;
    }

    get visibleRows() {
        return this.filteredRows.slice(0, this.pageSize);
    }
    get shownCount() {
        return this.visibleRows.length;
    }
    get hasMore() {
        return this.filteredRows.length > this.pageSize;
    }
    get moreLabel() {
        const remaining = this.filteredRows.length - this.pageSize;
        return `Show ${Math.min(PAGE_SIZE, remaining)} more owners`;
    }
    get noMatches() {
        return this.hasData && this.filteredRows.length === 0;
    }
    get noMatchMessage() {
        return `No owner name contains "${this.searchTerm}". Clear the search to see all ${this.totalOwners} owners.`;
    }

    // ---------------------------------------------------------------- actions
    handleSearch(event) {
        this.searchTerm = event.detail.value;
        this.pageSize = PAGE_SIZE;
    }
    handleClearSearch() {
        this.searchTerm = '';
        this.pageSize = PAGE_SIZE;
    }
    handleSort(event) {
        this.sortBy = event.detail.value;
        this.pageSize = PAGE_SIZE;
    }
    handleShowMore() {
        this.pageSize += PAGE_SIZE;
    }

    async handleRefresh() {
        if (this.refreshing) return;
        this.refreshing = true;
        try {
            await refreshApex(this._wired);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Team rollup refreshed',
                    message: `${this.total} at-risk records across ${this.totalOwners} owners.`,
                    variant: 'success'
                })
            );
        } catch (e) {
            const reduced = reduceError(e);
            // eslint-disable-next-line no-console
            console.error('SentinelLeaderboard refresh failed', e);
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
