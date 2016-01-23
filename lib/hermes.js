var mysql = require('mysql');
var handlebars = require('handlebars');
var winston = require('winston');

var logger = new winston.Logger();
logger.add(require('winston-daily-rotate-file'), {
    filename: 'hermes',
    datePattern: 'yyyy-MM-dd'
});

module.exports = function (tblConfig) {
    var hermes = {};

    hermes.connection = undefined;

    hermes.connect = function (opts) {
        hermes.connection = mysql.createConnection(opts);
        hermes.connection.connect();
    };

    hermes.config = {};
    hermes.config.lastSync = {
        table: 'lastSync',
        valueField: 'lastSync',
        tableNameField: 'tableName',
        queryTemplate: 'select {{valueField}} from {{table}} where {{tableNameField}} = ?',
        updateTemplate: 'update {{table}} set {{valueField}} = ? where {{tableNameField}} = ?',
        insertTemplate: 'insert into {{table}} ({{valueField}}, {{tableNameField}}) values (?, ?)'
    };

    hermes.config.sqlTable = tblConfig;

    hermes.config.mapping = [
        {
            dest: "dasData",
            src: "data_1",
            id: true
        },
        {
            dest: "dasData1",
            src: "data_2"
        },
        {
            dest: "dasData2",
            src: "data_3"
        }
    ];

    hermes.lastSuccessfulWrite = undefined;


    hermes.lastSync = function (cb) {
        var template = handlebars.compile(hermes.config.lastSync.queryTemplate);
        return hermes.connection.query(template(hermes.config.lastSync), [hermes.config.sqlTable.table], function (err, rows, fields) {
            if (err) return cb(err);
            if (rows.length < 1) return cb(null, null);

            return cb(null, rows[0][hermes.config.lastSync.valueField]);
        });
    };

    hermes.setLastSync = function (val, cb) {
        var qry = handlebars.compile(hermes.config.lastSync.queryTemplate)(hermes.config.lastSync);
        return hermes.connection.query(qry, [hermes.config.sqlTable.table], function (err, rows) {
            if (err) return cb(err);

            var template = '';
            if (rows.length > 0)
                template = (handlebars.compile(hermes.config.lastSync.updateTemplate))(hermes.config.lastSync);
            else
                template = handlebars.compile(hermes.config.lastSync.insertTemplate)(hermes.config.lastSync);

            return hermes.connection.query(template, [val, hermes.config.sqlTable.table], function (err) {
                if (err) return cb(err);

                return cb(null, val);
            });
        });
    };

    hermes.getData = function (cb) {
        hermes.lastSync(function (err, lastSync) {
            if (err) return cb(err);

            lastSync = lastSync || hermes.config.sqlTable.minLastUpdatedVal;
            var qryTemplate = handlebars.compile(hermes.config.sqlTable.selectTemplate)(hermes.config.sqlTable);

            return hermes.connection.query(qryTemplate, [lastSync], cb);
        });
    };

    hermes.getReadStream = function (cb) {
        hermes.getData(function (err, data) {
            if (err) return cb(err);

            var stream = require('stream').Readable({
                objectMode: true
            });

            stream.cache = data;

            stream._read = function () {
                if (stream.cache && stream.cache.length > 0) {
                    stream.push(stream.cache.shift());
                } else {
                    stream.push(null);
                }
            };
            return cb(null, stream);
        });
    };


    hermes.findRecord = function (srcRecord, cb) {
        var cfg = hermes.config.sqlTable;
        var ids = hermes.config.mapping.filter(function (map) {
            return !!map.id;
        });

        // Start assembling the query to find this particular item
        var qry = 'select ' + cfg.primaryKey + ' from ' + cfg.table;
        var where = '';
        var params = [];
        ids.forEach(function (id) {
            if (where) where += ' AND ';
            where += id.dest + ' = ? ';
            params += srcRecord[id.src];
        });
        qry += ' WHERE ' + where;

        hermes.connection.query(qry, params, function (err, rows) {
            if (err) {
                logger.error(JSON.stringify(err));
                return cb(err);
            }

            var pkValue = undefined;
            if (rows.length > 0) pkValue = rows[0][cfg.primaryKey];

            return cb(null, pkValue);
        });
    };

    hermes.updateRecord = function (srcRecord, destPkValue, cb) {
        var cfg = hermes.config.sqlTable;
        var params = [];
        var setVals = hermes.config.mapping.map(function (m) {
            params.push(srcRecord[m.src]);
            return m.dest + ' = ?';
        });
        var qry = 'UPDATE ' + cfg.table + ' SET ' + setVals.join(', ') + ' WHERE ' + cfg.primaryKey + ' = ?';
        params.push(destPkValue);

        hermes.connection.query(qry, params, function (err) {
            if (err) return cb(err);

            logger.info('Record updated. PK: ', destPkValue, '\nSource: ', JSON.stringify(srcRecord));
            return cb(null, destPkValue);
        });
    };

    hermes.insertRecord = function (srcRecord, cb) {
        var cfg = hermes.config.sqlTable;
        var destFields = [];
        var questionMarks = [];
        var srcValues = [];
        hermes.config.mapping.forEach(function (m) {
            destFields.push(m.dest);
            questionMarks.push('?');
            srcValues.push(srcRecord[m.src]);
        });

        var qry = 'INSERT INTO ' + cfg.table + ' (' + destFields.join(', ') + ') VALUES (' + questionMarks.join(', ') + ')';
        hermes.connection.query(qry, srcValues, function (err) {
            if (err) return cb(err);

            logger.info('Record created. Source: ', JSON.stringify(srcRecord));
            return cb(null);
        });
    };

    hermes.getWriteStream = function (cb) {
        var stream = require('stream').Writable({
            objectMode: true
        });

        stream._write = function (chunk, enc, next) {
            if (!chunk) return next();

            var cfg = hermes.config.sqlTable;
            var ids = hermes.config.mapping.filter(function (map) {
                return !!map.id;
            });

            var writeCb = function (err) {
                if (err) return stream.emit("error", err);

                hermes.lastSuccessfulWrite = chunk;
                return next();
            };

            hermes.findRecord(chunk, function (err, pkValue) {
                if (err) return stream.emit("error", err);

                if (pkValue)
                    hermes.updateRecord(chunk, pkValue, writeCb);
                else
                    hermes.insertRecord(chunk, writeCb);
            });
        };

        return cb(null, stream);
    };

    return hermes;
};
