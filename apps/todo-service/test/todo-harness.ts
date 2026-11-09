import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { KeysService, UserKeys } from '@life/service-kit';
import { Todo } from '../src/todos/todo.entity.js';
import { TodoCompletion } from '../src/todos/todo-completion.entity.js';
import { TodoTag } from '../src/todos/todo-tag.entity.js';
import { List } from '../src/lists/list.entity.js';
import { TodosService } from '../src/todos/todos.service.js';
import { ListsService } from '../src/lists/lists.service.js';
import { TodosCache } from '../src/cache/todo-cache.js';

/**
 * Shared service-level test harness for the unit suites (encryption, search
 * parity, cache). Each harness owns a throwaway sqlite file under the OS temp
 * dir; this helper NEVER opens anything under `apps/todo-service/data/**` (the
 * hard line). Support module — not collected by the pinned `testRegex`.
 */

/** Deterministic, obviously-fake test master key (matches `test/setup-env.ts`). */
export const TEST_MASTER_KEY = Buffer.alloc(32, 0x2c);
export const SUB = 'user-a';

export interface UnitHarness {
  dataSource: DataSource;
  keys: KeysService;
  todos: TodosService;
  lists: ListsService;
  cache: TodosCache;
  dir: string;
  /** Every SQL statement the driver emitted (metadata-only assertions). */
  log: string[];
}

export async function makeUnitHarness(
  cache: TodosCache = new TodosCache(null),
  options: { logging?: boolean } = {},
): Promise<UnitHarness> {
  const dir = mkdtempSync(join(tmpdir(), 'todo-unit-'));
  const log: string[] = [];
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: join(dir, 'todo.db'),
    entities: [Todo, TodoTag, List, UserKeys, TodoCompletion],
    synchronize: true,
    logging: options.logging ?? false,
    logger: {
      logQuery: (query: string) => {
        log.push(query);
      },
      logQueryError: () => undefined,
      logQuerySlow: () => undefined,
      logSchemaBuild: () => undefined,
      logMigration: () => undefined,
      log: () => undefined,
    } as never,
  });
  await dataSource.initialize();
  const keys = new KeysService(dataSource.getRepository(UserKeys), TEST_MASTER_KEY);
  const lists = new ListsService(dataSource.getRepository(List), cache, keys);
  const todos = new TodosService(
    dataSource.getRepository(Todo),
    dataSource.getRepository(TodoTag),
    cache,
    keys,
    lists,
    dataSource,
  );
  return { dataSource, keys, todos, lists, cache, dir, log };
}

/** Pin a row's `createdAt` (ordering fixtures) through the repository. */
export async function pinCreatedAt(dataSource: DataSource, id: string, when: Date): Promise<void> {
  await dataSource.getRepository(Todo).update(id, { createdAt: when, updatedAt: when });
}
