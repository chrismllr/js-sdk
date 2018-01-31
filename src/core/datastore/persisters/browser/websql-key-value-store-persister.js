import { KinveyError } from '../../../errors';

import { KeyValueStorePersister } from './../key-value-store-persister';
import { webSqlCollectionsMaster, webSqlDatabaseSize } from '../utils';
import { ensureArray } from '../../../utils';

export class WebSqlKeyValueStorePersister extends KeyValueStorePersister {
  getKeys() {
    const query = 'SELECT name AS value FROM #{collection} WHERE type = ?';
    return this._openTransaction(webSqlCollectionsMaster, query, ['table'], false)
      .then((response) => {
        return response.result
          .filter(table => (/^[a-zA-Z0-9-]{1,128}/).test(table));
      });
  }

  // protected methods

  _readFromPersistance(collection) {
    const sql = 'SELECT value FROM #{collection}';
    return this._openTransaction(collection, sql, [])
      .then(response => response.result);
  }

  _writeToPersistance(collection, allEntities) {
    if (!allEntities) {
      return Promise.reject(new KinveyError('Invalid or missing entities array'));
    }

    return this._deleteFromPersistance(collection)
      .then(() => this._upsertEntities(collection, allEntities));
  }

  _deleteFromPersistance(collection) {
    // TODO: this should drop the table, instead of deleting all rows
    return this._openTransaction(collection, 'DELETE FROM #{collection}', null, true)
      .then((response) => ({ count: response.rowCount }));
  }

  _readEntityFromPersistance(collection, entityId) {
    const sql = 'SELECT value FROM #{collection} WHERE key = ?';
    return this._openTransaction(collection, sql, [entityId])
      .then(response => response.result[0]);
  }

  _writeEntitiesToPersistance(collection, entities) {
    return this._upsertEntities(collection, ensureArray(entities));
  }

  _deleteEntityFromPersistance(collection, entityId) {
    const query = 'DELETE FROM #{collection} WHERE key = ?';
    return this._openTransaction(collection, query, [entityId], true)
      .then(response => response.rowCount);
  }

  // private methods

  _openTransaction(collection, query, parameters, write = false) {
    const escapedCollection = `"${collection}"`;
    const isMaster = collection === webSqlCollectionsMaster;
    const isMulti = Array.isArray(query);
    query = isMulti ? query : [[query, parameters]];

    return new Promise((resolve, reject) => {
      try {
        const db = global.openDatabase(this._storeName, 1, 'Kinvey Cache', webSqlDatabaseSize);
        const writeTxn = write || typeof db.readTransaction !== 'function';

        db[writeTxn ? 'transaction' : 'readTransaction']((tx) => {
          if (write && !isMaster) {
            tx.executeSql(`CREATE TABLE IF NOT EXISTS ${escapedCollection} ` +
              '(key BLOB PRIMARY KEY NOT NULL, value BLOB NOT NULL)');
          }

          let pending = query.length;
          const responses = [];

          if (pending === 0) {
            resolve(isMulti ? responses : responses.shift());
          } else {
            query.forEach((parts) => {
              const sql = parts[0].replace('#{collection}', escapedCollection);

              tx.executeSql(sql, parts[1], (_, resultSet) => {
                const response = {
                  rowCount: resultSet.rowsAffected,
                  result: []
                };

                if (resultSet.rows.length > 0) {
                  for (let i = 0, len = resultSet.rows.length; i < len; i += 1) {
                    try {
                      const value = resultSet.rows.item(i).value; // eslint-disable-line prefer-destructuring
                      const entity = isMaster ? value : JSON.parse(value);
                      response.result.push(entity);
                    } catch (error) {
                      // Catch the error
                    }
                  }
                }

                responses.push(response);
                pending -= 1;

                if (pending === 0) {
                  resolve(isMulti ? responses : responses.shift());
                }
              });
            });
          }
        }, (error) => {
          error = typeof error === 'string' ? error : error.message;

          if (error && error.indexOf('no such table') === -1) {
            return resolve({ result: [] });
          }

          const query = 'SELECT name AS value from #{collection} WHERE type = ? AND name = ?';
          const parameters = ['table', collection];

          return this._openTransaction(webSqlCollectionsMaster, query, parameters).then((response) => {
            if (response.result.length === 0) {
              return resolve({ result: [] });
            }

            return reject(new KinveyError(`Unable to open a transaction for the ${collection}`
              + ` collection on the ${this._storeName} WebSQL database.`));
          }).catch(reject);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  _upsertEntities(collection, entities) {
    const singular = !Array.isArray(entities);
    entities = ensureArray(entities);

    if (entities.length === 0) {
      return Promise.resolve(null);
    }

    const queries = entities.map((entity) => {
      return [
        'REPLACE INTO #{collection} (key, value) VALUES (?, ?)',
        [entity._id, JSON.stringify(entity)]
      ];
    });

    return this._openTransaction(collection, queries, null, true)
      .then(() => (singular ? entities[0] : entities));
  }
}
