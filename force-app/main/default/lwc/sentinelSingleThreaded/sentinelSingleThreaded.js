import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { reduceError, matches } from 'c/sentinelUtils';
import getSingleThreaded from '@salesforce/apex/SentinelDashboardController.getSingleThreaded';

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
    { label: 'Amount, high to low', value: 'amount-desc' },
    { label: 'Idle longest first', value: 'age-desc' },
    { label: 'Idle shortest first', value: 'age-asc' },
    { label: 'Deal name A–Z', value: 'name-asc' },
    { label: 'Owner A–Z', value: 'owner-asc' }
];

export default class SentinelSingleThreaded extends LightningElement {
    records;
    error;
    errorDetail = '';
    refreshing = false;

    searchTerm = '';
    sortBy = 'amount-desc';
    pageSize = PAGE_SIZE;
    sortOptions = SORT_OPTIONS;

    expandedIds = {};

    _wired;

    @wire(getSingleThreaded)
    wiredRecords(result) {
        this._wired = result;
        if (result.data) {
            this.records = result.data;
            this.error = undefined;
            this.errorDetail = '';
        } else if (result.error) {
            const reduced = reduceError(result.error);
            // eslint-disable-next-line no-console
            console.error('SentinelSingleThreaded.getSingleThreaded failed', result.error);
            this.error = reduced.friendly;
            this.errorDetail = reduced.detail;
            this.records = undefined;
        }
    }

    // ------------------------------------------------------------------ state
    get hasData() {
        return !!(this.records && this.records.length);
    }
    get showSkeleton() {
        return !this.records && !this.error;
    }
    get showError() {
        return !!this.error;
    }
    get showEmpty() {
        return !!this.records && !this.hasData;
    }
    get errorMessage() {
        return this.error || '';
    }
    get refreshLabel() {
        return this.refreshing ? 'Refreshing data…' : 'Refresh';
    }

    get totalCount() {
        return this.hasData ? this.records.length : 0;
    }
    get readoutValue() {
        return this.hasData ? String(this.totalCount) : '';
    }
    get totalAmount() {
        return this.hasData ? this.records.reduce((sum, r) => sum + (r.amount || 0), 0) : 0;
    }
    get criticalCount() {
        return this.hasData ? this.records.filter((r) => r.band === 'Critical').length : 0;
    }

    // ------------------------------------------------------------------- rows
    get allRows() {
        if (!this.hasData) return [];
        return this.records.map((r) => {
            const expanded = !!this.expandedIds[r.id];
            const band = r.band || 'Aging';
            return {
                id: r.id,
                name: r.name,
                url: r.url,
                owner: r.ownerName || 'Unassigned',
                stage: r.priority || 'No stage',
                band,
                severity: band.toLowerCase(),
                ageDays: r.ageDays === null || r.ageDays === undefined ? 0 : r.ageDays,
                ageText: r.ageDays === null || r.ageDays === undefined ? '-' : `${r.ageDays}d idle`,
                amount: r.amount || 0,
                hasAmount: !!r.amount,
                explanation: r.explanation || 'Flagged by the configured idle threshold.',
                lastActivityText: r.lastActivitySubject
                    ? `${r.lastActivitySubject}${r.lastActivityDate ? ` (${r.lastActivityDate})` : ''}`
                    : 'No completed activity has ever been logged against this record.',
                nextStepText: r.nextStepSubject
                    ? `${r.nextStepSubject}${r.nextStepDate ? ` (due ${r.nextStepDate})` : ''}`
                    : 'No open task is scheduled, nothing will pull this deal forward.',
                expanded,
                expandedAttr: expanded ? 'true' : 'false',
                toggleIcon: expanded ? 'utility:chevronup' : 'utility:chevrondown',
                toggleAlt: expanded ? `Hide details for ${r.name}` : `Show details for ${r.name}`,
                menuAlt: `Actions for ${r.name}`,
                rowClass: expanded ? 'register__item register__item--open' : 'register__item'
            };
        });
    }

    get filteredRows() {
        const term = this.searchTerm;
        const rows = this.allRows.filter(
            (r) => matches(r.name, term) || matches(r.owner, term) || matches(r.stage, term)
        );
        const [field, direction] = this.sortBy.split('-');
        const sorted = [...rows].sort((a, b) => {
            if (field === 'name') return String(a.name).localeCompare(String(b.name));
            if (field === 'owner') return String(a.owner).localeCompare(String(b.owner));
            if (field === 'age') return a.ageDays - b.ageDays;
            return a.amount - b.amount;
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
        return `Show ${Math.min(PAGE_SIZE, remaining)} more deals`;
    }
    get noMatches() {
        return this.hasData && this.filteredRows.length === 0;
    }
    get noMatchMessage() {
        return `Nothing matches "${this.searchTerm}" in deal name, owner or stage. Clear the search to see all ${this.totalCount} deals.`;
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

    handleToggle(event) {
        const id = event.currentTarget.dataset.id;
        this.expandedIds = { ...this.expandedIds, [id]: !this.expandedIds[id] };
    }

    handleRowAction(event) {
        const action = event.detail.value;
        const id = event.currentTarget.dataset.id;
        const row = this.allRows.find((r) => r.id === id);
        if (!row) return;

        if (action === 'open') {
            window.open(row.url, '_blank', 'noopener');
            return;
        }
        if (action === 'copy') {
            this.copyLink(row);
        }
    }

    async copyLink(row) {
        try {
            await navigator.clipboard.writeText(row.url);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Link copied',
                    message: `${row.name} record link is on your clipboard.`,
                    variant: 'success'
                })
            );
        } catch (e) {
            // Clipboard access can be blocked by browser policy; show the link instead.
            // eslint-disable-next-line no-console
            console.warn('Clipboard write blocked', e);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Copy the link manually',
                    message: row.url,
                    variant: 'warning',
                    mode: 'sticky'
                })
            );
        }
    }

    async handleRefresh() {
        if (this.refreshing) return;
        this.refreshing = true;
        try {
            await refreshApex(this._wired);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Register refreshed',
                    message: `${this.totalCount} single-threaded at-risk deals.`,
                    variant: 'success'
                })
            );
        } catch (e) {
            const reduced = reduceError(e);
            // eslint-disable-next-line no-console
            console.error('SentinelSingleThreaded refresh failed', e);
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
