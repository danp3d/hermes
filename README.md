[![Build Status](https://travis-ci.org/danp3d/hermes.svg?branch=master)](https://travis-ci.org/danp3d/hermes)
# Hermes

Database synchronisation tool for MySQL

## Usage

Select a source and destination table. The source table needs to contain a timestamp column which gets updated on each modification (common practice).
e.g
``` sql
    CREATE TABLE `tbl1` (
        id int auto_increment not null primary key,
        data_1 varchar(30) not null,
        data_2 int,
        data_3 int,
        lastUpdated timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP);
    );
```

You will need a 'lastSync' table to control the synchronisation.
``` sql
    CREATE TABLE `lastSync` (
	id int auto_increment not null primary key,
    tableName varchar(100) not null unique,
    lastSync timestamp);
```

Now you just need to setup the tables.

``` js
var Hermes = require('hermes');

// Create source table
var source = Hermes({
    table: 'tbl1',
    lastUpdated: 'lastUpdated',
    minLastUpdatedVal: new Date('1980-01-01'),
    selectTemplate: 'select * from {{table}} where {{lastUpdated}} > ? order by {{lastUpdated}} asc',
    primaryKey: 'id'
});

// Create dest table
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
        dest: "identifierField1",
        src: "identifierField",
        id: true
    },
    {
        dest: "dataField1",
        src: "dataField"
    },
    {
        dest: "dataField2",
        src: "name"
    }
];

// connect to MySQL
source.connect({
    host: 'sourcehost',
    user: 'usr',
    password: 'pwd',
    database: 'sourcedb'
});

dest.connect({
    host: 'desthost',
    user: 'usr',
    password: 'pwd',
    database: 'destdb'
});
```

After creating the tables, you can get a Readable or Writable stream - so you can pipe() them.
``` js
source.getReadStream(function (err, sourceStream) {
    if (err) return done(err);

    dest.getWriteStream(function (err, destStream) {
        if (err) return done(err);

        sourceStream.pipe(destStream);
    });
});           
```
##### LICENSE: GPL-3.0
##### AUTHOR: [Daniel Pedroso](https://github.com/danp3d)
