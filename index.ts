import { Database, SQLiteError, type Statement } from "bun:sqlite";

type Primitive = string | number | boolean | null | undefined;

type Data = Primitive | { [key: string]: Primitive };

interface Result {
	json_data: string | null;
	counter: number;
	expires_at: number | null;
	created_at: number;
	updated_at: number;
}

type InsertParams = {
	$key: string;
	$json_data: string | null;
	$expires_at: number | null;
};

function format<TData extends Data>(result: Result | null) {
	if (!result) {
		return null;
	}
	const parsed =
		result.json_data === null ? null : (JSON.parse(result.json_data) as TData);

	return {
		data: parsed as TData,
		counter: result.counter,
		expiresAt: result.expires_at ? new Date(result.expires_at * 1000) : null,
		createdAt: new Date(result.created_at * 1000),
		updatedAt: new Date(result.updated_at * 1000),
	};
}

export class KV {
	readonly db: Database;
	readonly #statements: {
		select: Statement<Result, [string]>;
		deleteSelect: Statement<Result, [string]>;
		deleteSingle: Statement<never, [string]>;
		insertIgnore: Statement<never, [InsertParams]>;
		insertReplace: Statement<never, [InsertParams]>;
		addToCounter: Statement<Result, [{ $key: string; $delta: number }]>;
	};

	constructor(dbPath = process.env.KV_DB_PATH ?? "/tmp/kv/db.sqlite") {
		this.db = new Database(dbPath);

		this.db.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA synchronous = NORMAL;
			PRAGMA busy_timeout = 5000;
			PRAGMA cache_size = -2000;
			PRAGMA temp_store = MEMORY;
			
			CREATE TABLE IF NOT EXISTS kv (
				key TEXT NOT NULL PRIMARY KEY,
				json_data TEXT,
				counter INTEGER NOT NULL DEFAULT 0,
				expires_at INTEGER,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				updated_at INTEGER NOT NULL DEFAULT (unixepoch())
			);
			
			CREATE TRIGGER IF NOT EXISTS update_updated_at_on_update
			AFTER UPDATE ON kv
			BEGIN
				UPDATE kv SET updated_at = unixepoch() WHERE key = NEW.key;
			END;
			
			CREATE TRIGGER IF NOT EXISTS cleanup_expired_on_insert
			BEFORE INSERT ON kv
			BEGIN
				DELETE FROM kv
				WHERE expires_at IS NOT NULL AND expires_at <= unixepoch();
			END;
			
			CREATE TRIGGER IF NOT EXISTS cleanup_expired_on_delete
			BEFORE DELETE ON kv
			BEGIN
				DELETE FROM kv
				WHERE expires_at IS NOT NULL AND expires_at <= unixepoch();
			END;
			`);

		this.#statements = {
			select: this.db.prepare<Result, string>(`
				SELECT json_data, counter, expires_at, created_at, updated_at FROM kv 
				WHERE key = ? AND (expires_at IS NULL OR expires_at > unixepoch())
				LIMIT 1
			`),
			deleteSelect: this.db.prepare<Result, string>(`
				DELETE FROM kv WHERE key = ? AND (expires_at IS NULL OR expires_at > unixepoch())
				RETURNING json_data, counter, expires_at, created_at, updated_at
			`),
			insertIgnore: this.db.prepare<never, InsertParams>(`
				INSERT INTO kv (key, json_data, expires_at) 
				VALUES ($key, $json_data, $expires_at)
			`),

			insertReplace: this.db.prepare<never, InsertParams>(`
				REPLACE INTO kv (key, json_data, expires_at) 
				VALUES ($key, $json_data, $expires_at)
			`),

			deleteSingle: this.db.prepare<never, string>(`
				DELETE FROM kv WHERE key = ?
			`),

			addToCounter: this.db.prepare<Result, { $key: string; $delta: number }>(`
			UPDATE kv 
			SET counter = COALESCE(counter, 0) + $delta 
			WHERE key = $key AND (expires_at IS NULL OR expires_at > unixepoch())
			RETURNING json_data, counter, expires_at, created_at, updated_at
		`),
		};
	}

	get = <TData extends Data>(key: string) =>
		format<TData>(this.#statements.select.get(key));

	getDel = <TData extends Data>(key: string) =>
		format<TData>(this.#statements.deleteSelect.get(key));

	set = <TData extends Data>(
		key: string,
		data: TData,
		opts: { replace?: boolean } & (
			| { ttl?: number }
			| { expiresAt?: Date }
		) = {},
	) => {
		let expiresAt: number | null = null;
		if ("ttl" in opts && opts.ttl !== undefined) {
			expiresAt = Math.floor(Date.now() / 1000) + opts.ttl;
		} else if ("expiresAt" in opts && opts.expiresAt !== undefined) {
			expiresAt = Math.floor(opts.expiresAt.getTime() / 1000);
		}
		const jsonData = data === null ? null : JSON.stringify(data);

		if (opts.replace) {
			this.#statements.insertReplace.run({
				$key: key,
				$json_data: jsonData,
				$expires_at: expiresAt,
			});

			return true;
		}

		try {
			this.#statements.insertIgnore.run({
				$key: key,
				$json_data: jsonData,
				$expires_at: expiresAt,
			}).changes > 0;

			return true;
		} catch (e) {
			if (
				e instanceof SQLiteError &&
				e.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
			) {
				return false;
			}
			throw e;
		}
	};

	del = (...keyOrKeys: [string, ...string[]]) => {
		switch (keyOrKeys.length) {
			case 0:
				return;
			case 1:
				this.#statements.deleteSingle.run(keyOrKeys[0]);
				return;
			default: {
				const placeholders = new Array(keyOrKeys.length).fill("?").join(",");
				const deleteMultipleQuery = this.db.query(
					`DELETE FROM kv WHERE key IN (${placeholders})`,
				);
				deleteMultipleQuery.run(...keyOrKeys);
			}
		}
	};

	increment = <TData extends Data>(key: string) =>
		this.#addToCounter<TData>(key, 1);

	decrement = <TData extends Data>(key: string) =>
		this.#addToCounter<TData>(key, -1);

	#addToCounter = <TData extends Data>(key: string, delta: number) =>
		format<TData>(
			this.#statements.addToCounter.get({ $key: key, $delta: delta }),
		);
}
