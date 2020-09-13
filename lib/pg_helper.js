/*****************************************************************************************************/
/* file : pg_helper.js
/* author : Ashwinkumar R
/* 
/* This file is responsible for the following functionality
/*      - connect/reconnnect to the DB and create a connection handler
/*      - Execute the queries and send bacl result to server
/*      - Close the DB connection
/*
/* NOTE: Make sure your postgres server allows incoming connection from the host where App runs.
/*
/*****************************************************************************************************/

const pg = require('pg');

class pgConnection {
    constructor(logger,options) {
        this.logger = logger;
        this.options = options;
        this.dbclient = null;
        this.connected = false;
        this.reconnectTimer = null;
        this.stopFlag = false;
    }

    async connect_client() {
        let that = this;

        return new Promise((resolve, reject) => {
            try {
                if (!that.options) {
                    let msg = 'postgres connection params is not specified';
                    that.logger.debug(msg);
                    reject(msg);
                }
        
                that.dbclient = new pg.Client(that.options);
        
                that.logger.debug(`connect_client: Connecting to Postgres server at ${that.options.host}, ${that.options.port}, DB:${that.options.database}`);
    
                that.dbclient.connect(function(err) {                    
                    if (err) {
                        let msg = `postgres connection error: ${err.message}, ${err.code} for ${that.options.host}, ${that.options.port}, DB:${that.options.database}`;
                        that.dbclient = null;
                        that.connected = false;
                        reject(msg);
                    } else {
                        that.logger.info(`connect_client: Connected to Postgres server at ${that.options.host}, ${that.options.port}, DB:${that.options.database}`);
                        that.connected = true;
                        resolve(that.dbclient);
                    }
                })
            } catch (err) {
                reject(`Unexpected error during postgres connection. Error: ${err}`);
            }
        })
    }

    async reconnect() {
        let that = this;
        return new Promise(async (resolve, reject) => {

            if(that.reconnectTimer !== null) {
                clearTimeout(that.reconnectTimer)
                that.reconnectTimer = null;
            }

            try {
                that.dbConn = await that.connect_client();

                that.dbConn.on('error', function(err) {
                    that.logger.error(`reconnect: Postgres server error on idle connection : ${err.code}`);
                });
        
                that.dbConn.on('end', function() {
                    that.dbclient = null;
                    that.connected = false;
                    that.logger.info(`reconnect: Connection to Postgres server closed for ${that.options.host}, ${that.options.port}, DB:${that.options.database}`);
                    //Try reconnecting after 30 secs, since connection is closed unexpectedly
                    if (!that.stopFlag) {
                        that.logger.debug(`reconnect: Try reconnecting after ${that.options.reconnect_timeout} ms delay`);
                        that.reconnectTimer = setTimeout(that.reconnect.bind(that), that.options.reconnect_timeout);    
                    }
                });
                resolve(this.dbConn); //send the connection handler
            } catch (err) {
                that.dbclient = null;
                that.connected = false;
                that.logger.debug(`reconnect: Postgres reconnect attempt failed, continue retrying after ${that.options.reconnect_timeout} ms delay`);
                that.reconnectTimer = setTimeout(that.reconnect.bind(that), that.options.reconnect_timeout);
            }
        })
    }

    async connect() {
        let that = this;
        return new Promise(async (resolve, reject) => {

            if(that.reconnectTimer !== null) {
                clearTimeout(that.reconnectTimer)
                that.reconnectTimer = null;
            }

            try {
                that.dbConn = await that.connect_client();

                that.dbConn.on('error', function(err) {
                    that.logger.error(`connect: Postgres server error on idle connection : ${err.code}`);
                });
        
                that.dbConn.on('end', function() {
                    that.dbclient = null;
                    that.connected = false;
                    that.logger.info(`connect: Connection to Postgres server closed for ${that.options.host}, ${that.options.port}, DB:${that.options.database}`);
                    //Try reconnecting after 30 secs, since connection is closed unexpectedly
                    if (!that.stopFlag) {
                        that.logger.debug(`connect: Try reconnecting after ${that.options.reconnect_timeout} ms delay`);
                        that.reconnectTimer = setTimeout(that.reconnect.bind(that), that.options.reconnect_timeout);    
                    }
                });
                resolve(this.dbConn); //send the connection handler
            } catch (err) {
                that.dbclient = null;
                that.connected = false;
                reject(err);
            }
        })
    }

    isConnected() {
        return (this.dbclient && this.connected);
    }

    async runQuery(sql) {
        let that = this;
        return new Promise((resolve,reject) => {
            if (that.isConnected()) {
                that.dbclient.query(sql, function(err,res) {
                    if (err) {
                        that.logger.debug(`runQuery: Executing query failed : ${err}`);
                        reject(`Executing query failed : ${err.code || err}`);
                    } else {
                        resolve(res.rows);
                    }
                })
            } else {
                reject('Database connection is not ready. Cannot run query.');
            }    
        }) 
    }

    async close() {
        let that = this;
        return new Promise((resolve, reject) => {
            if (that.dbclient === null) {
                resolve();
            }

            if (that.reconnectTimer) {
                clearTimeout(that.reconnectTimer);
                that.reconnectTimer = null;
            }
          
            that.stopFlag = true;

            that.logger.debug(`close: Closing postgres server connection for ${that.options.host}, ${that.options.port}, DB:${that.options.database}`);
            that.dbclient.end( function(err) {
                if (err) {
                    that.logger.error('close: Error during postgres server disconnection', err.stack);
                    reject(err);
                } else {
                    that.logger.info('close: Postgres client has disconnected');
                    resolve();
                }
            })
            that.dbclient = null;
        })
    }
}

module.exports = pgConnection;