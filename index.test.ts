import type { Database } from "bun:sqlite";
import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { KV } from "./index";

const nowUnix = () => Math.floor(Date.now() / 1000);

const insert = (
	db: Database,
	{
		key,
		json_data,
		counter,
		created_at,
		expires_at,
	}: {
		key: string;
		json_data: string | null;
		counter: number;
		created_at: number;
		expires_at: number | null;
	},
) =>
	db
		.query(`
	INSERT INTO kv (key, json_data, counter, created_at, expires_at) 
	VALUES ($key, $json_data, $counter, $created_at, $expires_at)
`)
		.run({
			$key: key,
			$json_data: json_data,
			$counter: counter,
			$created_at: created_at,
			$expires_at: expires_at,
		});

describe("kv", () => {
	let kv: KV;

	beforeEach(() => {
		kv = new KV(":memory:");
	});

	test("sets and gets", () => {
		expect(kv.set("test-key-1", "test-value", { ttl: 5 })).toBeTrue();
		expect(kv.set("test-key-2", "test-value")).toBeTrue();
		expect(
			kv.set(
				"test-key-3",
				{ data: "test-value" },
				{
					expiresAt: new Date(Date.now() + 10_000),
				},
			),
		).toBeTrue();

		expect(kv.get("test-key-1")).toEqual({
			data: "test-value",
			counter: 0,
			expiresAt: expect.any(Date),
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		expect(kv.get("test-key-2")).toEqual({
			data: "test-value",
			counter: 0,
			expiresAt: null,
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		expect(kv.get("test-key-3")).toEqual({
			data: { data: "test-value" },
			counter: 0,
			updatedAt: expect.any(Date),
			expiresAt: expect.any(Date),
			createdAt: expect.any(Date),
		});
	});

	test("gets and deletes", () => {
		expect(kv.set("test-key-1", "test-value", { ttl: 5 })).toBeTrue();
		expect(kv.getDel("test-key-1")).not.toBeNull();
		expect(kv.getDel("test-key-1")).toBeNull();
	});

	test("doesn't return expired values", () => {
		insert(kv.db, {
			key: "test-key-1",
			json_data: "test-value",
			counter: 0,
			created_at: nowUnix() - 10,
			expires_at: nowUnix() - 5,
		});
		expect(kv.get("test-key-1")).toBeNull();
	});

	test("ignores on conflict", () => {
		expect(kv.set("test-key-1", "test-value-1")).toBeTrue();
		expect(kv.set("test-key-1", "test-value-2")).toBeFalse();
		expect(kv.get("test-key-1")).toEqual({
			data: "test-value-1",
			counter: 0,
			expiresAt: null,
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
	});

	test("deletes expired value before setting", () => {
		insert(kv.db, {
			key: "test-key-1",
			json_data: "test-value-1",
			counter: 0,
			created_at: nowUnix() - 10,
			expires_at: nowUnix() - 5,
		});
		expect(kv.set("test-key-1", "test-value-2")).toBeTrue();
		expect(kv.get("test-key-1")).toEqual({
			data: "test-value-2",
			counter: 0,
			expiresAt: null,
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
	});

	test("replaces existing value", () => {
		expect(kv.set("test-key-1", "test-value-1")).toBeTrue();
		expect(
			kv.set("test-key-1", "test-value-2", { replace: true, ttl: 5 }),
		).toBeTrue();
		expect(kv.get("test-key-1")).toEqual({
			data: "test-value-2",
			counter: 0,
			expiresAt: expect.any(Date),
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
	});

	test("returns null if counter doesn't exist or is expired", () => {
		expect(kv.increment("test-key-1")).toEqual(null);
		insert(kv.db, {
			key: "test-key-2",
			json_data: null,
			counter: 1,
			created_at: nowUnix() - 10,
			expires_at: nowUnix() - 5,
		});
		expect(kv.decrement("test-key-2")).toEqual(null);
	});

	test("increments and decrements counter", () => {
		expect(kv.set("test-key-1", "test-value-1")).toBeTrue();
		expect(kv.increment("test-key-1")?.counter).toEqual(1);
		expect(kv.decrement("test-key-1")?.counter).toEqual(0);
		expect(kv.get("test-key-1")?.counter).toEqual(0);
		expect(kv.increment("test-key-1")?.counter).toEqual(1);
		expect(kv.increment("test-key-1")?.counter).toEqual(2);
		expect(kv.get("test-key-1")?.counter).toEqual(2);
	});

	test("deletes single key", () => {
		expect(kv.set("test-key-1", "test-value-1")).toBeTrue();
		expect(kv.set("test-key-2", "test-value-2")).toBeTrue();
		kv.del("test-key-1");
		expect(kv.get("test-key-1")).toBeNull();
		expect(kv.get("test-key-2")).toEqual({
			data: "test-value-2",
			counter: 0,
			expiresAt: null,
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
	});

	test("deletes multiple keys", () => {
		expect(kv.set("test-key-1", "test-value-1")).toBeTrue();
		expect(kv.set("test-key-2", "test-value-2")).toBeTrue();
		expect(kv.set("test-key-3", "test-value-3")).toBeTrue();
		kv.del("test-key-1", "test-key-2");
		expect(kv.get("test-key-1")).toBeNull();
		expect(kv.get("test-key-2")).toBeNull();
		expect(kv.get("test-key-3")).toEqual({
			data: "test-value-3",
			counter: 0,
			expiresAt: null,
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
	});
});
