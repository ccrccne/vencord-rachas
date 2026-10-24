import * as DataStore from "@api/DataStore";
import definePlugin from "@utils/types";
import { Tooltip, useEffect, useReducer, UserStore } from "@webpack/common";

const STORE_KEY = "Rachas_v1";
const KEEP_DAYS = 400;

// Por cada chat privado: los días en que escribiste tú (m) y los días en que escribió la otra persona (t)
interface Days { m: string[]; t: string[]; }

let data: Record<string, Days> = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());

function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => DataStore.set(STORE_KEY, data), 2000);
}

// Día en la hora local, ej. "2026-10-23"
function dayKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const shift = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function addDay(list: string[], day: string) {
    if (list.includes(day)) return false;
    list.push(day);
    list.sort();
    if (list.length > KEEP_DAYS) list.splice(0, list.length - KEEP_DAYS);
    return true;
}

function record(channelId: string, authorId: string, when: Date) {
    const me = UserStore.getCurrentUser()?.id;
    if (!me) return false;
    const entry = data[channelId] ??= { m: [], t: [] };
    return addDay(authorId === me ? entry.m : entry.t, dayKey(when));
}

// Cuenta los días seguidos en que los dos escribieron, terminando hoy o ayer.
// "pending" = la racha viene de ayer y hoy todavía falta que alguien escriba.
function streakOf(channelId: string) {
    const entry = data[channelId];
    if (!entry) return { count: 0, pending: false };
    const mine = new Set(entry.m), theirs = new Set(entry.t);
    const both = (d: Date) => mine.has(dayKey(d)) && theirs.has(dayKey(d));

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

function isDM(channel: any) {
    return channel?.type === 1; // 1 = chat privado con una sola persona
}

function useRefresh() {
    const [, force] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        listeners.add(force);
        return () => void listeners.delete(force);
    }, []);
}

function Racha({ channelId }: { channelId: string; }) {
    useRefresh();
    const { count, pending } = streakOf(channelId);
    if (count < 2) return null; // un solo día todavía no es racha

    const tip = pending
        ? `Racha de ${count} días. ¡Escríbanse hoy para no perderla!`
        : `Racha de ${count} días: los dos se escribieron todos estos días`;

    return (
        <Tooltip text={tip}>
            {tooltipProps => (
                <span
                    {...tooltipProps}
                    style={{
                        display: "inline-flex", alignItems: "center", gap: 2,
                        marginLeft: 6, fontSize: "12px", fontWeight: 700,
                        color: pending ? "var(--text-muted)" : "#f4b73f",
                        opacity: pending ? 0.75 : 1,
                        whiteSpace: "nowrap"
                    }}
                >
                    {pending ? "⏳" : "⭐"} {count}
                </span>
            )}
        </Tooltip>
    );
}

export default definePlugin({
    name: "Rachas",
    description: "Muestra una estrellita con los días seguidos que llevas hablando con alguien por mensaje privado.",
    authors: [{ name: "cancercocaine", id: 1425095870399123662n }],

    renderMemberListDecorator: ({ type, channel }) =>
        type === "dm" && isDM(channel) ? <Racha channelId={channel.id} /> : null,

    flux: {
        MESSAGE_CREATE({ channelId, message, optimistic }: { channelId: string; message: any; optimistic: boolean; }) {
            if (optimistic || !message?.author || message.guild_id) return;
            if (record(channelId, message.author.id, new Date(message.timestamp ?? Date.now()))) {
                save();
                emit();
            }
        },

        // Al abrir un chat, Discord carga los mensajes recientes: así se aprende la racha que ya tenían
        LOAD_MESSAGES_SUCCESS({ channelId, messages }: { channelId: string; messages: any[]; }) {
            if (!messages?.length || messages[0]?.guild_id) return;
            let changed = false;
            for (const msg of messages) {
                if (msg.author && msg.timestamp) changed = record(channelId, msg.author.id, new Date(msg.timestamp)) || changed;
            }
            if (changed) {
                save();
                emit();
            }
        }
    },

    async start() {
        data = (await DataStore.get<Record<string, Days>>(STORE_KEY)) ?? {};
        emit();
    },

    stop() {
        clearTimeout(saveTimer);
        DataStore.set(STORE_KEY, data);
    }
});
