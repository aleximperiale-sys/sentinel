import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { reduceError, matches } from 'c/sentinelUtils';
import getSnoozed from '@salesforce/apex/SentinelDashboardController.getSnoozed';

const PAGE_SIZE = 20;
const SOON_DAYS = 3;

const SORT_OPTIONS = [
    { label: 'Waking soonest first', value: 'days-asc' },
    { label: 'Waking latest first', value: 'days-desc' },
    { label: 'Record A–Z', value: 'name-asc' },
    { label: 'Object A–Z', value: 'object-asc' }
];

/**
 * Uses NavigationMixin rather than an href because Apex does not return a URL for
 * snoozed rows; navigation by record id resolves correctly in Lightning
 * Experience, Experience Cloud and the mobile app.
 */
export default class SentinelSnoozed extends NavigationMixin(LightningElement) {
    snoozed;
    error;
    errorDetail = '';
    refreshing = false;

    searchTerm = '';
    sortBy = 'days-asc';
    pageSize = PAGE_SIZE;
    sortOptions = SORT_OPTIONS;

    _wired;

    @wire(getSnoozed)
    wiredSnoozed(result) {
        this._wired = result;
        if (result.data) {
            this.snoozed = result.data;
            this.error = undefined;
            this.errorDetail = '';
        } else if (result.error) {
            const reduced = reduceError(result.error);
            // eslint-disable-next-line no-console
            console.error('SentinelSnoozed.getSnoozed failed', result.error);
            this.error = reduced.friendly;
            this.errorDetail = reduced.detail;
            this.snoozed = undefined;
        }
    }

    // ------------------------------------------------------------------ state
    get hasData() {
        return !!(this.snoozed && this.snoozed.length);
    }
    get showSkeleton() {
        return !this.snoozed && !this.error;
    }
    get showError() {
        return !!this.error;
    }
    get showEmpty() {
        return !!this.snoozed && !this.hasData;
    }
    get errorMessage() {
        return this.error || '';
    }
    get refreshLabel() {
        return this.refreshing ? 'Refreshing data…' : 'Refresh';
    }

    get totalCount() {
        return this.hasData ? this.snoozed.length : 0;
    }
    get readoutValue() {
        return this.hasData ? String(this.totalCount) : '';
    }
    get expiringSoonCount() {
        return this.hasData ? this.snoozed.filter((s) => (s.daysRemaining || 0) <= SOON_DAYS).length : 0;
    }
    get objectCount() {
        if (!this.hasData) return 0;
        return new Set(this.snoozed.map((s) => s.objectApiName)).size;
    }

    // ------------------------------------------------------------------- rows
    get allRows() {
        if (!this.hasData) return [];
        return this.snoozed.map((s) => {
            const days = s.daysRemaining === null || s.daysRemaining === undefined ? 0 : s.daysRemaining;
            const countdown = this.countdownFor(days);
            return {
                key: s.recordId,
                recordId: s.recordId,
                objectApiName: s.objectApiName,
                displayName: s.displayName,
                reason: s.reason || 'No reason was recorded.',
                snoozedByName: s.snoozedByName || 'Unknown',
                snoozedUntil: s.snoozedUntil,
                daysRemaining: days,
                severity: countdown.severity,
                countdownLabel: countdown.label,
                countdownTooltip: `Returns to the at-risk lists on ${s.snoozedUntil}.`,
                menuAlt: `Actions for ${s.displayName}`
            };
        });
    }

    countdownFor(days) {
        if (days <= 0) return { severity: 'critical', label: 'Wakes today' };
        if (days === 1) return { severity: 'critical', label: '1 day left' };
        if (days <= SOON_DAYS) return { severity: 'stale', label: `${days} days left` };
        return { severity: 'info', label: `${days} days left` };
    }

    get filteredRows() {
        const term = this.searchTerm;
        const rows = this.allRows.filter(
            (r) =>
                matches(r.displayName, term) ||
                matches(r.reason, term) ||
                matches(r.snoozedByName, term) ||
                matches(r.objectApiName, term)
        );
        const [field, direction] = this.sortBy.split('-');
        const sorted = [...rows].sort((a, b) => {
            if (field === 'name') return String(a.displayName).localeCompare(String(b.displayName));
            if (field === 'object') return String(a.objectApiName).localeCompare(String(b.objectApiName));
            return a.daysRemaining - b.daysRemaining;
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
        return `Show ${Math.min(PAGE_SIZE, remaining)} more records`;
    }
    get noMatches() {
        return this.hasData && this.filteredRows.length === 0;
    }
    get noMatchMessage() {
        return `Nothing matches "${this.searchTerm}" in record name, reason, person or object. Clear the search to see all ${this.totalCount} snoozed records.`;
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

    handleOpen(event) {
        this.navigateToRecord(event.currentTarget.dataset.id);
    }

    handleRowAction(event) {
        const recordId = event.currentTarget.dataset.id;
        if (event.detail.value === 'open') {
            this.navigateToRecord(recordId);
            return;
        }
        this.copyRecordLink(recordId);
    }

    navigateToRecord(recordId) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId, actionName: 'view' }
        });
    }

    async copyRecordLink(recordId) {
        const row = this.allRows.find((r) => r.recordId === recordId);
        const name = row ? row.displayName : 'Record';
        try {
            const url = await this[NavigationMixin.GenerateUrl]({
                type: 'standard__recordPage',
                attributes: { recordId, actionName: 'view' }
            });
            const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`;
            await navigator.clipboard.writeText(absolute);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Link copied',
                    message: `${name} record link is on your clipboard.`,
                    variant: 'success'
                })
            );
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('Could not copy record link', e);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Could not copy the link',
                    message: 'Open the record from the menu and copy the address from your browser instead.',
                    variant: 'warning'
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
                    title: 'Deferrals refreshed',
                    message: `${this.totalCount} snoozed records, ${this.expiringSoonCount} waking within ${SOON_DAYS} days.`,
                    variant: 'success'
                })
            );
        } catch (e) {
            const reduced = reduceError(e);
            // eslint-disable-next-line no-console
            console.error('SentinelSnoozed refresh failed', e);
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
