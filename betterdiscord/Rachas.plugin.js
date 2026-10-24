/**
 * @name Rachas
 * @author cancercocaine
 * @authorId 1425095870399123662
 * @description Cuenta los días seguidos que llevas hablando con alguien por mensaje privado. Haz clic derecho en la persona para ver tu racha.
 * @version 1.0.0
 * @source https://github.com/ccrccne/vencord-rachas
 */

const STORE_KEY = "rachas";
const KEEP_DAYS = 400;

// Día en la hora local, ej. "2026-10-23"
function dayKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const shift = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

module.exports = class Rachas {
    constructor(meta) {
        this.api = new BdApi(meta.name);
        // Por cada chat privado: los días en que escribiste tú (m) y los días en que escribió la otra persona (t)
        this.data = {};
        this.onMessage = this.onMessage.bind(this);
        this.onLoad = this.onLoad.bind(this);
    }

    start() {
        const { Data, Webpack, ContextMenu } = this.api;
        this.data = Data.load(STORE_KEY) ?? {};
        this.UserStore = Webpack.getStore("UserStore");
        this.ChannelStore = Webpack.getStore("ChannelStore");
        this.dispatcher = Webpack.getByKeys("dispatch", "subscribe", "unsubscribe");
        this.dispatcher.subscribe("MESSAGE_CREATE", this.onMessage);
        this.dispatcher.subscribe("LOAD_MESSAGES_SUCCESS", this.onLoad);

        this.unpatchMenu = ContextMenu.patch("user-context", (res, props) => {
            const user = props?.user;
            const children = res?.props?.children;
            if (!user || !Array.isArray(children)) return;
            const channelId = this.ChannelStore.getDMFromUserId(user.id);
            if (!channelId) return;
            children.push(ContextMenu.buildItem({ type: "separator" }), this.menuItem(channelId));
        });
    }

    stop() {
        this.dispatcher?.unsubscribe("MESSAGE_CREATE", this.onMessage);
        this.dispatcher?.unsubscribe("LOAD_MESSAGES_SUCCESS", this.onLoad);
        this.unpatchMenu?.();
        clearTimeout(this.saveTimer);
        this.api.Data.save(STORE_KEY, this.data);
    }

    save() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.api.Data.save(STORE_KEY, this.data), 2000);
    }

    record(channelId, authorId, when) {
        const me = this.UserStore.getCurrentUser()?.id;
        if (!me) return false;
        const entry = this.data[channelId] ??= { m: [], t: [] };
        const list = authorId === me ? entry.m : entry.t;
        const day = dayKey(when);
        if (list.includes(day)) return false;
        list.push(day);
        list.sort();
        if (list.length > KEEP_DAYS) list.splice(0, list.length - KEEP_DAYS);
        return true;
    }

    onMessage({ channelId, message, optimistic }) {
        if (optimistic || !message?.author || message.guild_id) return;
        if (this.record(channelId, message.author.id, new Date(message.timestamp ?? Date.now()))) this.save();
    }

    // Al abrir un chat, Discord carga los mensajes recientes: así se aprende la racha que ya tenían
    onLoad({ channelId, messages }) {
        if (!messages?.length || messages[0]?.guild_id) return;
        let changed = false;
        for (const msg of messages) {
            if (msg.author && msg.timestamp) changed = this.record(channelId, msg.author.id, new Date(msg.timestamp)) || changed;
        }
        if (changed) this.save();
    }

    // Cuenta los días seguidos en que los dos escribieron, terminando hoy o ayer
    streakOf(channelId) {
        const entry = this.data[channelId];
        if (!entry) return { count: 0, pending: false };
        const mine = new Set(entry.m), theirs = new Set(entry.t);
        const both = d => mine.has(dayKey(d)) && theirs.has(dayKey(d));
        const today = new Date();
        let cursor = both(today) ? today : shift(today, -1);
        const pending = cursor !== today;
        let count = 0;
        while (both(cursor)) {
            count++;
            cursor = shift(cursor, -1);
        }
        return { count, pending: pending && count > 0 };
    }

    menuItem(channelId) {
        const { count, pending } = this.streakOf(channelId);
        let label;
        if (count < 2) label = "⭐ Sin racha todavía";
        else if (pending) label = `⏳ Racha: ${count} días (¡escríbanse hoy!)`;
        else label = `⭐ Racha: ${count} días`;
        return this.api.ContextMenu.buildItem({ id: "rachas", label, action: () => { } });
    }
};
