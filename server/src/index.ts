import { Server, routePartykitRequest, type Connection, type ConnectionContext } from "partyserver";

type Env = { Cabin: DurableObjectNamespace<Cabin> };
type Stitch = { t: "K" | "P" | "O" | "C"; c: string };
type Player = { id: string; name: string; seat: number; color: string; cur: Stitch[]; rows: number; lastStitch: number; lastEmote: number };
type BlanketRow = { a: string; s: Stitch[] };

const PER_ROW = 12;
const MAX_PLAYERS = 5; // you plus four chairs around the fire
const BLANKET_SEND = 120; // rows sent to someone joining
const BLANKET_KEEP = 4000; // rows kept per circle
const TYPES = new Set(["K", "P", "O", "C"]);
const EMOTES = new Set(["wave", "tea", "yarn", "heart"]);

const cleanName = (v: unknown) =>
  String(v ?? "").normalize("NFKC").replace(/[^\p{L}\p{N} _'.-]/gu, "").trim().slice(0, 16) || "Knitter";
const cleanColor = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : "#e3d2b4");
const cleanStitch = (v: any): Stitch | null =>
  v && TYPES.has(v.t) ? { t: v.t, c: cleanColor(v.c) } : null;
const cleanRow = (v: unknown): Stitch[] =>
  Array.isArray(v) ? (v.slice(0, PER_ROW - 1).map(cleanStitch).filter(Boolean) as Stitch[]) : [];

/** One Durable Object per knitting circle. Player state lives on each connection, the blanket in SQLite,
 *  so the room can hibernate between messages and lose nothing. */
export class Cabin extends Server<Env> {
  static options = { hibernate: true };

  onStart() {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS blanket (id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL, data TEXT NOT NULL, ts INTEGER NOT NULL)`
    );
  }

  private players(): Player[] {
    const out: Player[] = [];
    for (const c of this.getConnections()) {
      const p = c.state as Player | null;
      if (p && p.id) out.push(p);
    }
    return out;
  }

  private send(conn: Connection, msg: unknown) {
    conn.send(JSON.stringify(msg));
  }

  private all(msg: unknown, except: string[] = []) {
    this.broadcast(JSON.stringify(msg), except);
  }

  private blanket(): { rows: BlanketRow[]; total: number } {
    const sql = this.ctx.storage.sql;
    const total = (sql.exec(`SELECT COUNT(*) AS n FROM blanket`).one().n as number) ?? 0;
    const rows = sql
      .exec(`SELECT author, data FROM blanket ORDER BY id DESC LIMIT ?`, BLANKET_SEND)
      .toArray()
      .reverse()
      .map((r) => ({ a: String(r.author), s: JSON.parse(String(r.data)) as Stitch[] }));
    return { rows, total };
  }

  onConnect(_conn: Connection, _ctx: ConnectionContext) {
    // Nothing until the client says hello with its name and yarn.
  }

  onMessage(conn: Connection, raw: string | ArrayBuffer | ArrayBufferView) {
    if (typeof raw !== "string" || raw.length > 4000) return;
    let m: any;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    const me = conn.state as Player | null;

    switch (m.t) {
      case "hello": {
        if (me) return;
        const others = this.players();
        if (others.length >= MAX_PLAYERS) {
          this.send(conn, { t: "full" });
          conn.close(4000, "Circle full");
          return;
        }
        const used = new Set(others.map((p) => p.seat));
        let seat = 0;
        while (used.has(seat)) seat++;
        const p: Player = {
          id: conn.id, name: cleanName(m.name), seat, color: cleanColor(m.color),
          cur: cleanRow(m.cur), rows: 0, lastStitch: 0, lastEmote: 0,
        };
        conn.setState(p);
        const { rows, total } = this.blanket();
        this.send(conn, { t: "welcome", you: conn.id, players: [...others, p], blanket: rows, total });
        this.all({ t: "join", player: p }, [conn.id]);
        return;
      }

      case "p": {
        // needle progress while someone is mid-swipe: cosmetic, relayed as-is
        if (!me) return;
        const p = Math.max(0, Math.min(100, Math.round(Number(m.p) || 0)));
        const ty = TYPES.has(m.ty) ? m.ty : "K";
        this.all({ t: "p", id: me.id, p, ty }, [conn.id]);
        return;
      }

      case "color": {
        if (!me) return;
        me.color = cleanColor(m.c);
        conn.setState(me);
        this.all({ t: "color", id: me.id, c: me.color }, [conn.id]);
        return;
      }

      case "stitch": {
        if (!me) return;
        const s = cleanStitch(m.s);
        const now = Date.now();
        if (!s || now - me.lastStitch < 120) return; // nobody knits that fast
        me.lastStitch = now;
        me.cur.push(s);
        if (me.cur.length >= PER_ROW) {
          const row = me.cur.slice(0, PER_ROW);
          me.cur = [];
          me.rows++;
          const sql = this.ctx.storage.sql;
          sql.exec(`INSERT INTO blanket (author, data, ts) VALUES (?, ?, ?)`, me.name, JSON.stringify(row), now);
          sql.exec(`DELETE FROM blanket WHERE id <= (SELECT MAX(id) FROM blanket) - ?`, BLANKET_KEEP);
          const total = sql.exec(`SELECT COUNT(*) AS n FROM blanket`).one().n as number;
          conn.setState(me);
          this.all({ t: "stitch", id: me.id, cur: me.cur }, [conn.id]);
          this.all({ t: "row", id: me.id, row: { a: me.name, s: row }, total });
          return;
        }
        conn.setState(me);
        this.all({ t: "stitch", id: me.id, cur: me.cur }, [conn.id]);
        return;
      }

      case "emote": {
        if (!me || !EMOTES.has(m.e)) return;
        const now = Date.now();
        if (now - me.lastEmote < 800) return;
        me.lastEmote = now;
        conn.setState(me);
        this.all({ t: "emote", id: me.id, e: m.e }, [conn.id]);
        return;
      }
    }
  }

  onClose(conn: Connection) {
    const p = conn.state as Player | null;
    if (p && p.id) this.all({ t: "leave", id: p.id }, [conn.id]);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("Weave Online circle server is running.", { headers: { "content-type": "text/plain" } });
    }
    return (await routePartykitRequest(request, env)) || new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
