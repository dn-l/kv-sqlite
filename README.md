# kv-sqlite

A fast, lightweight key-value store backed by SQLite, designed for Bun. Features automatic expiration, counters, and atomic operations with excellent performance through WAL mode and optimized SQLite settings.

## Features

- **Simple API** - Easy-to-use key-value operations
- **TTL Support** - Automatic expiration of keys with time-to-live
- **Counters** - Built-in increment/decrement operations
- **Atomic Operations** - Get-and-delete operations
- **Batch Operations** - Delete multiple keys at once
- **Automatic Cleanup** - Expired keys are automatically removed
- **High Performance** - Optimized SQLite settings with WAL mode
- **TypeScript** - Full type safety with generic data types
- **Persistent Storage** - Data survives application restarts
- **Memory Database** - Support for in-memory databases for testing

## Installation

```bash
bun add kv-sqlite
```

## Requirements

- Bun runtime (uses `bun:sqlite`)

## Quick Start

```typescript
import { KV } from "kv-sqlite";

// Create a new KV store
const kv = new KV(); // Uses default path: /tmp/kv/db.sqlite

// Or specify a custom path
const kv = new KV("/path/to/your/database.sqlite");

// Or use environment variable
// KV_DB_PATH=/path/to/db.sqlite
const kv = new KV();

// Set a value
kv.set("user:123", { name: "John", age: 30 });

// Get a value
const user = kv.get("user:123");
console.log(user?.data); // { name: "John", age: 30 }

// Set with TTL (expires in 60 seconds)
kv.set("session:abc", { userId: 123 }, { ttl: 60 });

// Set with explicit expiration date
kv.set("cache:key", "value", { 
  expiresAt: new Date(Date.now() + 5000) 
});
```

## API Reference

### Constructor

```typescript
new KV(dbPath?: string)
```

- `dbPath` - Path to SQLite database file. Defaults to `process.env.KV_DB_PATH` or `/tmp/kv/db.sqlite`

### Methods

#### `set<T>(key: string, data: T, options?: SetOptions): boolean`

Store a value with the given key.

**Parameters:**
- `key` - The key to store the value under
- `data` - The value to store (must be JSON-serializable)
- `options` - Optional settings

**Options:**
- `replace?: boolean` - If `true`, replace existing value. If `false` (default), ignore if key exists
- `ttl?: number` - Time-to-live in seconds
- `expiresAt?: Date` - Explicit expiration date

**Returns:** `true` if the value was set, `false` if key exists and `replace` is `false`

```typescript
// Basic set
kv.set("key", "value");

// Set with TTL
kv.set("session", { userId: 123 }, { ttl: 3600 });

// Set with expiration date
kv.set("cache", "data", { expiresAt: new Date("2024-12-31") });

// Replace existing value
kv.set("key", "new value", { replace: true });
```

#### `get<T>(key: string): KVResult<T> | null`

Retrieve a value by key.

**Returns:** Object with metadata or `null` if not found/expired

```typescript
const result = kv.get("key");
if (result) {
  console.log(result.data);      // Your stored data
  console.log(result.counter);   // Counter value (default: 0)
  console.log(result.expiresAt); // Expiration date or null
  console.log(result.createdAt); // Creation timestamp
  console.log(result.updatedAt); // Last update timestamp
}
```

#### `getDel<T>(key: string): KVResult<T> | null`

Atomically get and delete a value.

```typescript
const result = kv.getDel("session:abc");
// Value is returned and immediately deleted
```

#### `del(...keys: string[]): void`

Delete one or more keys.

```typescript
// Delete single key
kv.del("key");

// Delete multiple keys
kv.del("key1", "key2", "key3");
```

#### `increment<T>(key: string): KVResult<T> | null`

Increment the counter for a key by 1.

**Returns:** Updated result or `null` if key doesn't exist/expired

```typescript
kv.set("visits", null); // Initialize with null data
kv.increment("visits"); // Counter becomes 1
kv.increment("visits"); // Counter becomes 2
```

#### `decrement<T>(key: string): KVResult<T> | null`

Decrement the counter for a key by 1.

```typescript
kv.decrement("visits"); // Counter decreases by 1
```

### Return Type

```typescript
interface KVResult<T> {
  data: T;              // Your stored data
  counter: number;      // Counter value
  expiresAt: Date | null; // Expiration date
  createdAt: Date;      // Creation timestamp
  updatedAt: Date;      // Last update timestamp
}
```

## Advanced Usage

### Working with Counters

```typescript
// Initialize a counter
kv.set("page_views", { page: "/home" });

// Increment visits
kv.increment("page_views");
kv.increment("page_views");

const result = kv.get("page_views");
console.log(result?.counter); // 2
console.log(result?.data);    // { page: "/home" }
```

### Session Management

```typescript
// Create session with 1-hour TTL
kv.set("session:user123", { 
  userId: 123, 
  role: "admin" 
}, { ttl: 3600 });

// Get session
const session = kv.get("session:user123");
if (session) {
  console.log("User is logged in:", session.data);
} else {
  console.log("Session expired or not found");
}

// Destroy session
kv.del("session:user123");
```

### Caching

```typescript
// Cache API response for 5 minutes
const cacheKey = "api:users:list";
let users = kv.get(cacheKey);

if (!users) {
  // Fetch from API
  const response = await fetch("/api/users");
  const userData = await response.json();
  
  // Cache for 5 minutes
  kv.set(cacheKey, userData, { ttl: 300 });
  users = { data: userData };
}

return users.data;
```

## Environment Variables

- `KV_DB_PATH` - Default database path if not specified in constructor

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.