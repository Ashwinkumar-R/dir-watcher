/*****************************************************************************************************/
/* file : server.js
/* author : Ashwinkumar R
/* 
/* This file is responsible for the following functionality
/*      - Creates and monitor DB connection and send/receive all requests/responses to/from DB module
/*      - Creates Express server and required endpoints
/*      - Fork the background task(child) and handles IPC
/*      - Handles incoming change request via API and send them to child
/*
/*****************************************************************************************************/

const express = require('express');
const bodyParser = require('body-parser');
const ip = require('ip');
const { fork } = require('child_process');
const fs = require('fs');

const common = require('./lib/common');
const config = require('./lib/config');
const pgConnection = require('./lib/pg_helper');
const logger = require('./lib/logger');

const to = common.to; //wrapper to resolve "await" promise

const TABLE_COLUMNS = 'start_time,end_time,run_time_secs,files_added,files_deleted,magic_word,magic_word_count,run_status';
const BASE_RESULT_QUERY = 'select start_time,end_time,run_time_secs,files_added,files_deleted,magic_word,magic_word_count,run_status from ';

// logging options
const LOG_FILE = config.DEFAULT_LOG_DIR + config.APP_NAME + '_' + common.getIsoTime() + '.log';

class dirWatcher {
    constructor(options) {
        this.options = options;
        this.dbHandler = null; // db connection handler
        this.dbReconnectTimer = null; //db reconnection timer, used for reconnecting to DB
        this.appReady = false; // check application is initialized, (db connection should be ready)

        this.child = null; //child process to collect directory statistics (works based on IPC)
        this.child_ready = false; //When child successfully completes initial scan on startup, it is ready
        this.plannedStop = false; //If child process was stopped via manual request
        this.enums = config.ipc_messages; //IPC event messages

        //init parent logger
        let logParams = {
            level : this.options.log.level,
            maxLogSize : this.options.log.maxLogSize,
            name : config.APP_NAME,
            logFile : LOG_FILE,
        }

        this.logger=new logger(logParams);

        //db details
        this.dbParams = {
            user: this.options.db_params.dbuser,
            password: this.options.db_params.dbpass, 
            host: this.options.db_params.dbhost, 
            port: this.options.db_params.dbport,
            statement_timeout: this.options.db_params.dbstmtmout,
            database: this.options.db_params.dbname,
            table: this.options.db_params.dbtable,
            reconnect_timeout:  this.options.db_params.dbreconntout
        }

        //monitor details - update these details on each API request, so that if child restarts it picks the last change
        this.pollTime = this.options.monitor.pollTime;
        this.magicWord = this.options.monitor.magicWord;
        this.directory = this.options.monitor.directory;

        process.on( 'SIGTERM', () => {
            this.logger.debug('SIGTERM: Gracefully stop DirWatcher Application');
            this.closeConnections();
        });
        
        process.on( 'SIGINT', () => {
            this.logger.debug('SIGINT: Gracefully stop DirWatcher Application');
            this.closeConnections();
        });

        this.init_app();
    }

    /****************************** 
     child process related methods
    *******************************/

    async fork_child() {
        let that = this;

        that.plannedStop = false; //we are ready to start the child , so reset flag

        try {
            this.child = fork('statCollector.js', ['-level', that.options.log.level, '-size', that.options.log.maxLogSize, '-timer', this.pollTime, '-word', this.magicWord, '-dir', this.directory]);

            //handle messages to/from parent
            this.child.on('message', async (msg) => {
                that.logger.debug(`fork_child: Received message from child. Type: ${msg.type}`);
                switch (msg.type) {
                    case that.enums.child.RESULTS_READY : //scan result are ready
                        if (msg.results) {
                            await that.putResultsToDB(msg.results);
                        } else {
                            that.logger.debug('fork_child: Received empty results from child');
                        }
                        break;
                    case that.enums.child.CHILD_READY : // child is ready to accept change request
                        that.child_ready = true;
                        break;
                    case that.enums.child.CHILD_NOT_READY : // child is not ready to accept change request
                        that.child_ready = false;
                        break;
                }
            })

            let child_pid = that.child.pid; //To avoid errors during final exit

            that.logger.info(`fork_child: Child_${child_pid} started`)
    
            this.child.on('exit', (code, signal) => {
                that.logger.info(`fork_child: Child_${child_pid} exited with code ${code}, signal ${signal}.`)
                if (!that.plannedStop) { // child was exited accidentally, so restart
                    that.logger.debug(`fork_child: Child_${child_pid} was unexpectedly terminated. Restarting.`)
                    that.fork_child();
                }
            });
        } catch (err) {
            that.logger.debug(`fork_child: Exception in child process module : ${err}`)
        }
    }

    async stopChild() {
        if (this.child) {
            this.logger.debug(`stopChild: stopping child ${this.child.pid}`);
            this.child.kill('SIGTERM');
            this.child=null;
        }
    }

    //status whether child is running or stopped
    getChildStatus() {
        return this.child ? 'running' : 'stopped';
    }

    //To start/stop the background task
    executeTaskAction (action) {
        let that = this;
        if (action == 'start') {
            if (that.child) { // Ignore if child already alive
                let msg = `child process already running with pid ${that.child.pid}. Ignore starting.`;
                that.logger.debug(`executeTaskAction: ${msg}`);
                return [1, msg];
            } else { // start child, if it is not alive
                that.fork_child();
                let msg = 'started child process';
                return [0, msg];
            }
        } else if (action == 'stop') {
            if (that.child) { //stop if child is running
                let pid = that.child.pid;
                that.plannedStop = true;
                that.stopChild();
                that.child=null;
                let msg = `stopped child process with pid ${pid}`
                return [0, msg];
            } else { // Ignore if child not alive
                let msg = `No active child process running. Ignore stop.`;
                that.logger.debug(`executeTaskAction: ${msg}`);
                return [1, msg];
            }
        }
    }

    //Receive change request from API call and send it to child
    sendCommandToChild(type,value) {
        let that = this;
        
        if (this.child) { // child running
            if (this.child_ready && type != 3) { // child did not clear initial startup stage, but allow directory change
                switch (type) {
                    case this.enums.parent.CHANGE_POLL_INTERVAL :
                        this.pollTime = value;
                        this.child.send({type:this.enums.parent.CHANGE_POLL_INTERVAL, data:value});
                        break;
                    case this.enums.parent.CHANGE_MAGIC_WORD :
                        this.magicWord = value;
                        this.child.send({type:this.enums.parent.CHANGE_MAGIC_WORD, data:value});
                        break;
                }
                return {status: 'ok'}
            } else { // Allow changing directory, so that it may help in clearing intial scan
                if(type === this.enums.parent.CHANGE_DIR_SETTINGS) {
                    if (value) {
                        if(fs.existsSync(value)) { // check path to monitor exist
                            this.directory = value;
                            this.child.send({type:this.enums.parent.CHANGE_DIR_SETTINGS, data:value});
                            return {status: 'ok'}
                        } else {
                            let msg = `Invalid path ${value} given to monitor`;
                            return {status: 'error', msg: msg};
                        }
                    } else { //Invalid option
                        return {status: 'error', msg: 'Invalid option provided for Directory change'};
                    }
                }
                return {status: 'error', msg: 'Child not ready to accept changes'};
            }
        } else {
            return {status: 'error', msg: 'No active child'};
        }
    }

    /****************************** 
       Main app related methods
    *******************************/

    // module to start the app
    async init_app() {
        this.logger.info('init_app: Start initializing the main modules')

        //intialize db connection
        await this.init_db();

        //initialize APIs
        await this.init_routes();
    }

    //To check whether App is ready to process request to/from DB
    isAppReady() {
        return this.appReady && this.dbHandler.isConnected()
    }

    /**********************************
      DB related methods and operation 
    ***********************************/

    //Init the db connection
    async init_db() {

        if (!this.dbHandler) {
            this.dbHandler = new pgConnection(this.logger, this.dbParams);
        }

        //clear previous db reconnect timers
        if (this.dbReconnectTimer !== null) {
            clearTimeout(this.dbReconnectTimer);
            this.dbReconnectTimer = null;
        }

        try {
            await this.dbHandler.connect(this.dbParams);
            this.logger.debug(`init_db: Successfully connected to postgres db ${this.dbParams.database}`);
            await this.checkDBTableExist();
            this.appReady = true; //set the application to ready state
            if (!this.child) {
                this.fork_child(); //start the child process, as db connection is ready
            } else {
                this.logger.info(`init_db: child_${this.child.pid} process running. Ignore initing again...`);
            }        
        } catch (err) {
            this.appReady = false;
            this.logger.error(err);
            this.logger.debug(`init_db: Init the Postgres reconnecting with ${this.dbParams.reconnect_timeout} ms delay...`);
            this.dbReconnectTimer = setTimeout(this.init_db.bind(this), this.dbParams.reconnect_timeout); // In case of connection error, retry connecting after 30 secs
        }
    }

    // Check if table exist, create if not exist
    async checkDBTableExist() {
        return new Promise(async (resolve,reject) => {
            if (this.dbHandler.isConnected()) {
                let query = "SELECT tablename FROM pg_catalog.pg_tables WHERE tablename='" + this.dbParams.table + "'";
                let [err,rows] = await to (this.dbHandler.runQuery(query));
            
                if (err) {
                    this.logger.debug('checkDBTableExist: database request failed: %s', err);
                    reject(err);
                } 
                else {
                    let ret = rows && rows.length == 1 && rows[0]['tablename'] === this.dbParams.table;
                    if (ret) {
                        this.logger.debug(`checkDBTableExist: ${this.dbParams.table} table exist`);
                        resolve(ret);
                    } else { //create table
                        this.logger.debug(`checkDBTableExist: ${this.dbParams.table} table does not exist. creating...`);

                        let query = "CREATE TABLE " + this.dbParams.table + "(start_time timestamp(3) with time zone,\
                        end_time timestamp(3) with time zone,run_time_secs numeric,files_added jsonb,files_deleted jsonb,\
                        magic_word varchar(255),magic_word_count integer,run_status varchar(20))";
                        let [err,rows] = await to (this.dbHandler.runQuery(query));
            
                        if (err) {
                            this.logger.debug(`checkDBTableExist: creating table failed: ${err}`);
                            this.closeConnections()
                        } 
                        else { 
                            this.logger.debug(`checkDBTableExist: successfully created table: ${this.dbParams.table}`);
                            resolve();
                        }
                    }
                }
            } else {
                const msg = 'DB connection is not ready to query results..';
                reject(msg);
            }
        })
    }

    //get the task results from the DB
    async getResultsFromDB(limit,start) {
        if (this.isAppReady()) {
            let query = null;
            if (start) { // If start_time is provided, filter based on it
                query = BASE_RESULT_QUERY  + this.dbParams.table + ' where EXTRACT(epoch FROM start_time) >= ' + start + ' order by start_time desc limit ' + limit;
            } else { // Limit to last n rows
                query = BASE_RESULT_QUERY + this.dbParams.table + ' order by start_time desc limit ' + limit;
            }

            let [err,rows] = await to (this.dbHandler.runQuery(query));

            if (err) { // Error while executing query
                let msg = 'Error executing select query for processing result. Error: ' + err;
                this.logger.debug(`getResultsFromDB: ${msg}`);
                return {status:'error', error:msg};
            } else {
                if (rows && rows.length >= 0) { // query executed, but no data matched the query
                    return {status:'ok', result:rows};
                } else { // query executed, but returned null results
                    return {status:'error', error:'Query executed, but received empty results'};
                }
            }
        } else {
            const msg = 'DB connection is not ready to query results..';
            this.logger.debug(`getResultsFromDB: ${msg}`);
            return {status:'error', error:msg};
        }
    }

    //Insert the results to the DB
    async putResultsToDB(result) {
        if (this.isAppReady()) {

            /* Sample: "Insert into table (start_time,end_time,run_time_secs,files_added,files_deleted,magic_word,magic_word_count,run_status) 
                values (to_timestamp(1599737489),to_timestamp(1599737346),1.05,'{"added": {"name":"test2"}, "value":2}',
                '{"deleted": {"name":"test3"},"value":3}','findme',3,'failed') returning *" */
            
            // Frame the insert query
            const query = {
                text: 'Insert into ' + this.dbParams.table + '(' + TABLE_COLUMNS + ')' 
                + 'values (to_timestamp(' + result.start + '),' +'to_timestamp(' + result.end +'),'
                + '$1,$2,$3,$4,$5,$6) returning *',
                values: [result.total,result.added,result.deleted,result.word,result.word_count,result.status]
            }

            //this.logger.debug(`Query to execute : ${JSON.stringify(query)}`); //Turn on to see full query

            let [err,rows] = await to (this.dbHandler.runQuery(query));

            if (err) { // Error while executing query
                let msg = 'Error processing result. ' + err;
                this.logger.debug(`putResultsToDB: Insert query failed on execution, Error: ${msg}`);
                return 1;
            } else {
                if (rows && rows.length > 0) { // query executed successfully
                    this.logger.debug(`putResultsToDB: Insert query executed successfully`);
                    return 0;
                } else { // query executed, but returned null rows
                    this.logger.debug(`putResultsToDB: Insert query executed, but returned no results`);
                    return 1;
                }
            }

        } else {
            const msg = 'DB connection is not ready to insert data..';
            this.logger.debug(`putResultsToDB: ${msg}`);
            return 1;
        }
    }

    /**********************************
        Init Express server and API
    ***********************************/

    // Init the express server and configure all the routes
    async init_routes() {
        let that = this;
        let app = express();
        app.use(bodyParser.json());

        // Define a base route point
        let router = express.Router();
        app.use('/dirWatcher',router);

        // Express middleware wrapper to deal with async callbacks, will raise errors to next middleware handler
        const  asyncExpHandler = fn => (req, res, next) =>
        Promise
            .resolve(fn(req, res, next))
            .catch(next);

        // API to get the task run details
        router.post('/results', asyncExpHandler(async function (req,res,next) {
            let args = req.body;

            let limit = args && parseInt(args.limit) || 100; // last n records
            let start = args && args.start || null; // query based on start time

            let output = await that.getResultsFromDB(limit, start);

            if (output.status == 'ok') {
                res.status(200).send({result:'ok', data:output.result});
            } else {
                res.status(404).send({result:'error', msg:output.error});
            }
        }))

        // API to trigger an action (start/stop) on Directory Monitor
        router.post('/task', asyncExpHandler(async function (req,res,next) {
            let args = req.body;

            let action = args && args.action;

            if (action == 'start' || action == 'stop') {
                let [retcode,output] = await that.executeTaskAction(action);
                res.status(200).send({result:retcode ? 'ignored' : 'ok', msg:output});
            } else {
                let msg = `Expected action start/stop. Received ${action}`;
                res.status(400).send({result:'error', msg:msg});
            }
        }))

        //API to change the background task poll interval (input in ms)
        router.post('/interval', asyncExpHandler(async function (req,res,next) {
            let args = req.body;

            let interval = args && args.ms ? parseInt(args.ms) : null;

            if (interval) {
                let output = that.sendCommandToChild(that.enums.parent.CHANGE_POLL_INTERVAL,interval);

                if (output.status == 'ok') {
                    let msg = `Request to change polling interval to ${interval}ms sent to Background task`;
                    res.status(200).send({result:'ok', msg:msg});    
                } else {
                    res.status(404).send({result:'error', msg:output.msg});
                }
            } else {
                let msg = `Invalid interval provided. Interval should be given in ms`;
                res.status(400).send({result:'error', msg:msg});
            }
        }))

        //API to change the magic word to be find in the files
        router.post('/magicword', asyncExpHandler(async function (req,res,next) {
            let args = req.body;

            let word = args && args.word ? args.word : null;

            if (word) {
                let output = that.sendCommandToChild(that.enums.parent.CHANGE_MAGIC_WORD,word);

                if (output.status == 'ok') {
                    let msg = `Request to change magic word to ${word} sent to Background task`;
                    res.status(200).send({result:'ok', msg:msg});    
                } else {
                    res.status(404).send({result:'error', msg:output.msg});
                }
            } else {
                let msg = `Invalid/empty magic word`;
                res.status(400).send({result:'error', msg:msg});
            }
        }))

        //API to change the settings of the directory to be monitored
        router.post('/directory', asyncExpHandler(async function (req,res,next) {
            let args = req.body;

            let dirConfig = args && args.directory ? args.directory : null;

            if (dirConfig) {
                let output = that.sendCommandToChild(that.enums.parent.CHANGE_DIR_SETTINGS,dirConfig);

                if (output.status == 'ok') {
                    let msg = `Request to change directory configuration to ${JSON.stringify(dirConfig)} sent to Background task`;
                    res.status(200).send({result:'ok', msg:msg});
                } else {
                    res.status(404).send({result:'error', msg:output.msg});
                }
            } else {
                let msg = `Invalid/empty directory changes requested`;
                res.status(400).send({result:'error', msg:msg});
            }
        }))

        //API to get the background task running status
        router.get('/status', asyncExpHandler(async function (req,res,next) {
            let status = that.getChildStatus();
            res.status(200).send({result: 'ok', status:status});
        }))

        //middleware to handle errors
        router.use(function(err, req, res, next) {
            that.logger.error('Unhandled error occurred: ' + err);
            res.send('Server error occurred');
        });

        let appPort = this.options.app.appPort || 8080; //port on which app listens
        app.set('port',appPort);

        app.listen(appPort, function() {
            that.logger.info(`init_routes: Application DirWatcher running on http://${ip.address()}:${appPort}`)
        }).on('error', function(err) {
            that.logger.error(`init_routes: Error starting server. Err: ${err.message} Terminating process`);
            that.closeConnections();
        });
    }

    /***********************************
      Final closeup actions during exit
    ************************************/

    // To gracefully close connections and final cleanup
    async closeConnections() {
        this.plannedStop = true;
        if (this.dbHandler) {
            await this.dbHandler.close(); //close db connection
        }

        this.stopChild(); //stop the child process

        this.logger.debug('closeConnections: Exiting');
        await common.sleep(2000); //2secs grace period to complete writing final logs
        process.exit();
    }
}

module.exports = dirWatcher;