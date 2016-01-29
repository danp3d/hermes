var assert = require('assert');
var Hermes = require('./../index');

// Create table 'tbl1'
var source = Hermes({
    table: 'tbl1',
    lastUpdated: 'lastUpdated',
    minLastUpdatedVal: new Date('1980-01-01'),
    selectTemplate: 'select * from {{table}} where {{lastUpdated}} > ? order by {{lastUpdated}} asc',
    primaryKey: 'id'
});

// Create table 'tbl2'
var dest = Hermes({
    table: 'tbl2',
    lastUpdated: 'lastUpdated',
    minLastUpdatedVal: new Date('1980-01-01'),
    selectTemplate: 'select * from {{table}} where {{lastUpdated}} > ? order by {{lastUpdated}} asc',
    primaryKey: 'id'
});

// configure column mapping
dest.config.mapping = [
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


describe('One-way sync', function () {
    before(function () {
        // Connect to the databases
        source.connect({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'sync1'
        });

        dest.connect({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'sync2'
        });


        // Empty tables so we end up with a clean environment for testing
        var emptyTable = function (conn, table) {
            conn.query('delete from ' + table, function (err) {
                if (err) throw err;
            });
        }

        emptyTable(dest.connection, 'tbl2');
        emptyTable(dest.connection, 'lastSync');
        emptyTable(source.connection, 'tbl1');
        emptyTable(source.connection, 'lastSync');
    });

    it('should import new record', function (done) {
        // Insert manually and check if it synchronises down to tbl2
        source.connection.query('insert into tbl1 (data_1, data_2, data_3) values (?, ?, ?)', ['Dan', 1, 2], function (err) {
            if (err) return done(err);

            source.getReadStream(function (err, sourceStream) {
                if (err) return done(err);

                dest.getWriteStream(function (err, destStream) {
                    if (err) return done(err);

                    sourceStream.pipe(destStream).on('finish', function (err) {
                        if (err) return done(err);

                        // Check if the record is there and if the data is correct
                        dest.connection.query('select * from tbl2', function (err, rows) {
                            var original = dest.lastSuccessfulWrite;
                            var copy = rows[0];
                            //assert.notEqual(original.id, copy.id); (Can be equal :/)
                            assert.equal(original.data_1, copy.dasData);
                            assert.equal(original.data_2, copy.dasData1);
                            assert.equal(original.data_3, copy.dasData2);
                            done();
                        });
                    });
                });
            });
        });
    });

    it('should update existing record', function (done) {
        // Update a record from the first database and see if it flows down to the second
        source.connection.query('update tbl1 set data_2 = 666', function (err) {
            if (err) return done(err);

            source.getReadStream(function (err, sourceStream) {
                if (err) return done(err);

                dest.getWriteStream(function (err, destStream) {
                    if (err) return done(err);

                    sourceStream.pipe(destStream).on('finish', function (err) {
                        if (err) return done(err);

                        // Get the record manually from the db
                        dest.connection.query('select * from tbl2', function (err, rows) {
                            assert.equal(1, rows.length);
                            assert.equal(666, dest.lastSuccessfulWrite.data_2);
                            assert.equal(dest.lastSuccessfulWrite.data_2, rows[0].dasData1);
                            done();
                        });
                    });
                });
            });
        });
    });

    it('should update only once', function (done) {
        source.connection.query('update tbl1 set data_2 = 123', function (err) {
            if (err) return done(err);

            var runCount = 0;
            var readCount = 0;

            var runReadProcess = function () {
                if (runCount > 2) {
                    // Don't run anymore - time to check results
                    assert.equal(readCount, 1);
                    return done();
                }

                source.getReadStream(function (err, sourceStream) {
                    if (err) return done(err);

                    dest.getWriteStream(function (err, destStream) {
                        if (err) return done(err);

                        sourceStream.on('data', function (chunk) {
                            readCount++;
                            assert.equal(123, chunk.data_2);
                        });

                        sourceStream.pipe(destStream).on('finish', function (err) {
                            if (err) return done(err);

                            runCount++;
                            if (dest.lastSuccessfulWrite) {
                                source.setLastSync(dest.lastSuccessfulWrite.lastSync, function (err) {
                                    runReadProcess();
                                });
                            } else {
                                runReadProcess();
                            }
                        });
                    });
                });
            };

            runReadProcess();
        });
    });

});
