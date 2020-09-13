/*****************************************************************************************************/
/* file : config.js
/* author : Ashwinkumar R
/* 
/* This file is responsible for containing all the configuration required for the Application
/*
/*****************************************************************************************************/

const common = require('./common');

//APP options
const APP_NAME = 'DirWatcher';
const DEFAULT_APP_PORT = 8080;

//Monitor options
const DEFAULT_POLL_TIME = 300000; //every 300 secs
const DEFAULT_MAGIC_WORD = "hello" //magic string to search in file
const DEFAULT_LOOKUP_DIRECTORY = './' //Directory to monitor

//logging options
const DEFAULT_LOG_LEVEL = 'debug';
const DEFAULT_MAX_LOG_SIZE = null; // by default do not roll log
const DEFAULT_LOG_DIR = __dirname + '/../logs/';

//postgres DB options
const DEFAULT_DB_HOST = 'localhost';
const DEFAULT_DB_PORT = 5432;
const DEFAULT_DB_NAME = 'dir_watcher';
const DEFAULT_DB_TABLE = 'watcher';
const DEFAULT_DB_USER = 'postgres';
const DEFAULT_DB_PASS = ''; // To be supplied as argument, DO NOT store default/initial password
const DEFAULT_DB_STMT_TOUT = 40000; // query statement timeout
const DEFAULT_DB_RECONNECT_TOUT = 30000; // reconnection attempt timeout interval

//File extension to exclude from search
const EXCLUDE_FILES = ['.dll','.lib','.exe','.jpg','.png']; //also files greater than 1gb

let options = {
    app : {
        appName : APP_NAME,
        appPort : DEFAULT_APP_PORT
    },
    monitor : {
        pollTime : DEFAULT_POLL_TIME,
        magicWord : DEFAULT_MAGIC_WORD,
        directory : DEFAULT_LOOKUP_DIRECTORY 
    },
    db_params : {
        dbhost : DEFAULT_DB_HOST,
        dbport : DEFAULT_DB_PORT,
        dbname : DEFAULT_DB_NAME,
        dbtable : DEFAULT_DB_TABLE,
        dbuser : DEFAULT_DB_USER,
        dbpass : DEFAULT_DB_PASS,
        dbstmtmout : DEFAULT_DB_STMT_TOUT,
        dbreconntout : DEFAULT_DB_RECONNECT_TOUT
    },
    log : {
        level : DEFAULT_LOG_LEVEL,
        maxLogSize : DEFAULT_MAX_LOG_SIZE
    }
}

// IPC messages between parent and child
let ipc_messages = {
    parent : { //events that are sent from parent
        INVALID : 0, CHANGE_POLL_INTERVAL : 1, CHANGE_MAGIC_WORD : 2, CHANGE_DIR_SETTINGS : 3
    },
    child : { //events that are sent from child
        INVALID : 0, RESULTS_READY : 1, CHILD_READY : 2, CHILD_NOT_READY : 3
    }
}

module.exports.options = options;
module.exports.APP_NAME = APP_NAME;
module.exports.DEFAULT_LOG_DIR = DEFAULT_LOG_DIR;
module.exports.ipc_messages = ipc_messages;
module.exports.EXCLUDE_FILES=EXCLUDE_FILES;