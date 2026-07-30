import { LightningElement, api } from 'lwc';

/**
 * Skeleton placeholder. Each variant is sized to the *same box* as the real
 * content it stands in for, so nothing jumps when data arrives, which matters a
 * lot here because several Sentinel components share one page.
 *
 * variant: rows (default) | cards | charts | tiles | hero
 */
export default class SentinelSkeleton extends LightningElement {
    @api variant = 'rows';
    @api count = 4;
    @api loadingText = 'Loading data';

    get items() {
        const n = Math.max(1, Number(this.count) || 1);
        return Array.from({ length: n }, (_, i) => `sk-${i}`);
    }

    get isHero() {
        return this.variant === 'hero';
    }
    get isTiles() {
        return this.variant === 'tiles';
    }
    get isCards() {
        return this.variant === 'cards';
    }
    get isCharts() {
        return this.variant === 'charts';
    }
}
