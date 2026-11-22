/*
 * Copyright © 2025 Trent Piepho
 * Modified by Wyderar on 2026-11-22 for Foundry VTT v14 compatibility.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE for the full license text.
 */

const MODULENAME = "less-chat";
const views = new WeakMap();
const SCROLL_THRESHOLD = 20; // Foundry v14 requests history within 20px of the top.

function limit(key, fallback) {
    const value = game.settings.get(MODULENAME, key);
    return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : fallback;
}

const maximum = () => limit("chatRenderedMax", 50);
const batchSize = () => limit("chatRenderedBatch", 20);

Hooks.once("init", () => {
    game.settings.register(MODULENAME, "chatRenderedMax", {
        name: `${MODULENAME}.Settings.Max.name`,
        hint: `${MODULENAME}.Settings.Max.hint`,
        scope: "client",
        config: true,
        type: Number,
        default: 50,
        onChange: () => {
            for (const chat of [ui.chat, ui.chat?.popout]) views.get(chat)?.scheduleResize();
        },
    });
    game.settings.register(MODULENAME, "chatRenderedBatch", {
        name: `${MODULENAME}.Settings.Batch.name`,
        hint: `${MODULENAME}.Settings.Batch.hint`,
        scope: "client",
        config: true,
        type: Number,
        default: 20,
        onChange: () => {
            CONFIG.ChatMessage.batchSize = batchSize();
        },
    });
    CONFIG.ChatMessage.batchSize = batchSize();

    // Core's history cursor is private and becomes stale when we trim the DOM.
    // Its scroll handler still calls this public method and maintains the scroll anchor.
    foundry.applications.sidebar.tabs.ChatLog.prototype.renderBatch = async function (size = batchSize()) {
        if (!this.rendered) return;
        const log = this.element.querySelector(".chat-scroll .chat-log");
        if (!log) return;
        let view = views.get(this);
        if (view?.log !== log) {
            view?.close();
            view = new ChatHistory(this, log);
            views.set(this, view);
            size = maximum();
        } else if (view.scrollEvent?.currentTarget === view.scroll && view.atBothEnds) {
            // Removing rows can fire a native scroll event at both ends of a short log.
            return;
        }
        await view.load(size);
    };
});

Hooks.on("closeChatLog", (chat) => {
    views.get(chat)?.close();
    views.delete(chat);
});

// Core can skip forwarding a deletion to a popout if the sidebar has already pruned the card.
Hooks.on("deleteChatMessage", () => views.get(ui.chat?.popout)?.scheduleResize());
Hooks.on("updateChatMessage", (message) => {
    if (!message.visible) views.get(ui.chat?.popout)?.scheduleResize();
});

class ChatHistory {
    constructor(chat, log) {
        this.chat = chat;
        this.log = log;
        this.scroll = log.closest(".chat-scroll");
        this.scheduleResize = this.scheduleResize.bind(this);
        this.onScroll = (event) => {
            // currentTarget is set only during dispatch. Capture before Foundry's
            // listener so explicit renderBatch calls still work on a short log.
            this.scrollEvent = event;
            if (this.scroll.scrollTop >= SCROLL_THRESHOLD) this.readingShortLog = false;
            const distance = this.scroll.scrollHeight - this.scroll.clientHeight - this.scroll.scrollTop;
            if (distance < SCROLL_THRESHOLD) this.scheduleResize();
        };
        this.onWheel = this.onWheel.bind(this);
        this.observer = new MutationObserver(this.scheduleResize);
        this.observer.observe(log, { childList: true });
        this.scroll.addEventListener("scroll", this.onScroll, { capture: true, passive: true });
        this.scroll.addEventListener("wheel", this.onWheel, { passive: true });
    }

    close() {
        clearTimeout(this.timer);
        this.observer.disconnect();
        this.scroll.removeEventListener("scroll", this.onScroll, true);
        this.scroll.removeEventListener("wheel", this.onWheel);
    }

    get atBothEnds() {
        return this.chat.isAtBottom && this.scroll.scrollTop < SCROLL_THRESHOLD;
    }

    onWheel(event) {
        if (event.ctrlKey) return;
        if (event.deltaY < 0 && this.atBothEnds) {
            // A wheel gesture on a log that fits in the viewport generates no scroll event.
            this.readingShortLog = true;
            this.load(batchSize());
        } else if (event.deltaY > 0 && this.readingShortLog) {
            this.readingShortLog = false;
            this.scheduleResize();
        }
    }

    scheduleResize() {
        if (this.timer != null) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.resize();
        }, 250);
    }

    rows() {
        return this.log.querySelectorAll(":scope > [data-message-id]");
    }

    resize() {
        if (!this.chat.rendered || views.get(this.chat) !== this) return;
        if (this.pending) return this.pending.then(this.scheduleResize);
        const rows = new Map();
        for (const row of this.rows()) {
            if (row.classList.contains("deleting")) continue;
            const id = row.dataset.messageId;
            // Core can post into a popout that already displays this message, for
            // example when an edit makes a pruned sidebar card appear again.
            if (!this.chat.collection.get(id)?.visible || rows.has(id)) row.remove();
            else rows.set(id, row);
        }

        const excess = rows.size - maximum();
        if (excess > 0 && this.chat.isAtBottom && !this.readingShortLog) {
            // An edit to a pruned message can append an old card at the end of the log.
            const time = (row) => this.chat.collection.get(row.dataset.messageId)?.timestamp ?? 0;
            const oldest = [...rows.values()].sort((a, b) => time(a) - time(b)).slice(0, excess);
            for (const row of oldest) {
                const message = this.chat.collection.get(row.dataset.messageId);
                if (message && !this.chat.isPopout) message.logged = false;
                row.remove();
            }
        }
        this.updateOverflow();
        if (excess < 0) return this.load(-excess);
    }

    updateOverflow() {
        this.scroll.classList.toggle("overflowed", this.scroll.scrollHeight > this.scroll.offsetHeight);
    }

    load(size) {
        if (!this.pending) {
            this.pending = this.renderHistory(size).finally(() => {
                this.pending = null;
            });
        }
        return this.pending;
    }

    async renderHistory(size) {
        const { chat, log } = this;
        const rowsById = () => new Map(Array.from(this.rows(), (row) => [row.dataset.messageId, row]));
        const existing = rowsById();
        // Match native posting order, including messages delivered out of timestamp order.
        const messages = chat.collection.contents.sort((a, b) => a.timestamp - b.timestamp);
        const newest = existing.size ? messages.findLastIndex((m) => existing.has(m.id)) : messages.length - 1;
        const cards = new Map();
        let i = newest;
        for (; i >= 0 && cards.size < size; i--) {
            const message = messages[i];
            if (!message.visible || existing.has(message.id)) continue;
            try {
                cards.set(message, await chat.constructor.renderMessage(message));
            } catch (error) {
                Hooks.onError(MODULENAME, error, { msg: `Chat message ${message.id} failed to render`, log: "error" });
            }
        }

        // Posting, editing, deleting, or closing the view can happen during rendering.
        if (!chat.rendered || views.get(chat) !== this || !chat.element.contains(log) || !cards.size) return;
        const current = rowsById();
        let before = log.firstElementChild;
        for (let j = newest; j > i; j--) {
            const message = messages[j];
            if (current.has(message.id)) {
                before = current.get(message.id);
            } else if (cards.has(message) && message.visible && chat.collection.get(message.id) === message) {
                const row = cards.get(message);
                log.insertBefore(row, before);
                before = row;
                if (!chat.isPopout) message.logged = true;
            }
        }
        this.updateOverflow();
    }
}
