/*****************************************************************************************************/
/* file : watcher.js
/* author : Ashwinkumar R
/* 
/* This file is responsible for the following functionality
/*      - start watcher and watch for the changes in the configured folder
/*      - stop watching the folder (based on request) if no more required
/*      - provide changed file details to background process based on request
/*
/*****************************************************************************************************/

const chokidar = require('chokidar');
const path = require('path')

class folderWatcher {
    constructor (directory,logger) {
        this.logger = logger;
        this.watching = false;
        this.added_files = []; // list of newly added files
        this.deleted_files = []; // list of deleted files
        this.changed_files = []; // list of changed files
        this.directory = path.resolve(directory); // To get full path
    }

    //start watching the folder
    async start () {
        let that = this;
        return new Promise(async (resolve,reject) => {
            try {
                if (that.watching)  {
                    await this.stop();
                }
                
                that.watcher = chokidar.watch(that.directory, {
                    ignored: ['.dll','.lib','.exe','.jpg','.png'],
                    persistent: true,
                    ignoreInitial: true
                });
                
                // Add event listeners.
                that.watcher
                .on('add', async function(file) {
                    that.added_files.push(file);
                })
                .on('change', async function(file) {
                    that.changed_files.push(file);
                })
                .on('unlink', async function(file) {
                    that.deleted_files.push(file);
                })
                
                .on('error', error => log(`Watcher error: ${error}`))
                .on('ready', function() {
                    that.logger.info('folderWatcher: Initial scan complete. Ready for changes ')
                    that.watching = true;
                    resolve();
                })
            } catch (err) {
                console.log(err)
                reject(err);
            }
        })
    }
  
    //stop watching the folder
    async stop () {
        let that = this;
        return new Promise (async (resolve,reject) => {
            that.added_files = [];
            that.deleted_files = [];
            that.changed_files = [];
            if (!that.watching) {
                resolve();
            }
            that.watcher.close()
            that.logger.info('folderWatcher: stopped watching')
            that.watching = false
            resolve();
        })
    }

    //get list of files added
    get_added_files() {
        let temp = this.added_files;
        this.added_files = [];
        return temp;
    }

    //get list of files deleted
    get_deleted_files() {
        let temp = this.deleted_files;
        this.deleted_files = [];
        return temp;
    }

    //get list of files changed
    get_changed_files() {
        let temp = this.changed_files;
        this.changed_files = [];
        return temp;
    }
}

module.exports = folderWatcher;