/*****************************************************************************************************/
/* file : statCollector.js
/* author : Ashwinkumar R
/* 
/* This file is responsible for the following functionality
/*      - Runs a timer based scanning task to monitor configured folder
/*      - handle IPC messages from parent
/*      - Scan thorugh folders and collect details about the files and magic word
/*      - Collect changed files from watcher module and update the magic word count
/*      - Frame and send task run result to parent to insert in DB
/*
/*****************************************************************************************************/

const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');

const common = require('./lib/common');
const config = require('./lib/config');
const logger = require('./lib/logger.js')
const folderWatcher = require('./lib/watcher.js')

class statCollector {
    constructor() {

        let that = this;

        //parse the arguments
        for (var i=0; i < process.argv.length; i++) {
            var key = process.argv[i];
            var value = process.argv[i+1];
      
            if (key) {
                switch (key) {
                    case '-level':
                        this.logLevel = value;
                        break;
                    case '-size':
                        this.maxLogSize = value;
                        break;
                    case '-timer':
                        this.pollTimer = value;
                        break;
                    case '-word':
                        this.magicWord = value;
                        break;
                    case '-dir':
                        this.directory = value;
                        break;
                }
            }
        }

        // File related options
        this.excludeFiles = config.EXCLUDE_FILES; //List of files to exclude
        this.allFiles = {}; //to store files in directory and their magic word count during initial scan
        this.completedFileReads = 0; // Total number of successfully readed files
        this.totalMagicWord = 0; // Total number of magic words
        this.initialScanTimer = null; //Rescan timer in case of initial scan failure
        this.monitorTimer = null; //long running monitor timer

        this.child_ready = false; //child will be ready to accept change request from parent only if initial scan is completed
    
        this.watcher = null; //object to watcher class

        //IPC event messages
        this.enums = config.ipc_messages;

        // logging options
        const LOG_FILE = config.DEFAULT_LOG_DIR + 'child_'+ process.pid + '_' + common.getIsoTime() + '.log';

        let childName = 'child_'+process.pid;

        let logParams = {
            level : this.logLevel,
            maxLogSize : parseInt(this.maxLogSize),
            name : childName,
            logFile : LOG_FILE
        }

        //init child logger
        this.logger = new logger(logParams);

        this.logger.debug(`Child_${process.pid} is running`);

        //start scanning the directory first time and collect all files and magic word count
        this.initialScan();

        //handle messages to/from parent
        process.on('message', async (msg) => { 
            that.logger.debug(`Received message from parent. Type: ${msg.type}`);

            if (msg.type in Object.keys(that.enums.parent)) {
                that.handleIncomingChanges(msg);
            } else {
                that.logger.debug(`Received invalid message from parent. Type: ${msg.type}`);
            }
        })

        process.on('SIGINT', function () {
            that.logger.info(`SIGINT: Child_${process.pid} is shutting down gracefully.`);
            process.exit();
        })
    
        process.on('SIGTERM', function () {
            that.logger.info(`SIGTERM: Child_${process.pid} is shutting down gracefully.`);
            process.exit();
        })
    }

    // If magic_word or directory is changed, we need to do initial scan to find results from beginning and update cache
    async restartInitialScan() {
        // clear the periodic monitor as we are going to scan new search query
        if (this.monitorTimer) {
            this.logger.debug('clearing up monitor timer');
            clearInterval(this.monitorTimer);
            this.monitorTimer = null;
        }

        // stop the watcher if already running
        if (this.watcher) {
            this.logger.debug('stopping old watcher');
            await this.watcher.stop();
            this.watcher = null;
        }

        this.sendResultToParent(this.enums.child.CHILD_NOT_READY); //Notify parent that child is not ready

        this.initialScan();
    }

    // process all the incoming msg from parent and act accordingly
    // If magic_word or directory is changed, we need to do initial scan to find results from beginning and update cache
    handleIncomingChanges(msg) {
        switch (msg.type) {
            case this.enums.parent.CHANGE_POLL_INTERVAL :
                this.pollTimer = msg.data;
                this.logger.debug(`handleIncomingChanges: changing polling interval to ${this.pollTimer}ms, will reflect in next cycle`);
                break;
            case this.enums.parent.CHANGE_MAGIC_WORD :
                this.magicWord = msg.data;
                this.logger.debug(`handleIncomingChanges: changing magic word to '${this.magicWord}'`);
                this.restartInitialScan();
                break;
            case this.enums.parent.CHANGE_DIR_SETTINGS :
                this.directory = msg.data;
                this.logger.debug(`handleIncomingChanges: changing directory to scan to '${this.directory}'`);
                this.restartInitialScan();
                break;
        }
    }

    // Send the result to parent to insert into DB
    sendResultToParent(type,result=null) {
        process.send({type:type, results : result})
    }

    // Child status whether ready or not to accept change request
    child_status() {
        return this.child_ready;
    }

    //walk directory recursively to collect the files
    async dirWalker(dir,done) {
        let that = this;
        let results = [];

        fs.readdir(dir, function(err, list) {
            if (err) return done(err);
    
            var pending = list.length;
    
            if (!pending) return done(null, results);
    
            list.forEach(function(file){
                file = path.resolve(dir, file);
    
                fs.stat(file, function(err, stat){
                    // If directory, execute a recursive call
                    if (stat && stat.isDirectory()) {
    
                        that.dirWalker(file, function(err, res){
                            results = results.concat(res);
                            if (!--pending) done(null, results);
                        });
                    } else {
                        // Exclude files of omitted extension and files > 1gb from result list
                        that.excludeFiles.includes(path.extname(file).toLowerCase()) && stat["size"] < 1073741824 ?  null : results.push(file);
    
                        if (!--pending) done(null, results);
                    }
                });
            });
        });
    }

    // Collect and send back list of files in the directory
    async collectFiles(directory) {
        let that = this;
        return new Promise ((resolve,reject) => {
            that.dirWalker(directory, function(err, data){
                if(err){
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        })
    }

    //To check all the required files are readed 
    isReadComplete(totalFileReads){
        this.completedFileReads++;
        if(this.completedFileReads == totalFileReads) {
            this.completedFileReads = 0;
            return true;
        }
    };
    
    //search for the magic word in the entire text
    async searchWord(text,find) {
        return new Promise((resolve,reject) => {
            try {
                let pattern = new RegExp("\\b" + find + "\\b", 'g') //word boundary to check exact match
                let r = text.match(pattern)
                resolve(r && r.length);
            } catch (err) {
                reject(err)
            }
        })
    };

    // For file change events, update local cache and re-calculate total magic words
    async reUpdateCache(file, current_count, event, total) {
        let that = this;
        return new Promise((resolve,reject) => {
            try {
                if (event == 'added') { //update total and add entry to cache
                    that.allFiles[file] =  current_count ? current_count : 0;
                    total = current_count ? (total + current_count) : total; 
                } else if (event == 'changed') {
                    let old_count = that.allFiles[file];
                    if (current_count > old_count) { // c > o (incremented)
                        let latest = (current_count - old_count) + old_count;
                        total = total + (current_count - old_count);
                        that.allFiles[file] = latest;
                    } else { // c > o (decremented)
                        let latest = old_count - (old_count - current_count);
                        total = total - (old_count - current_count);
                        that.allFiles[file] = latest;
                    }
                } else if (event == 'deleted') { //subtract and remove entry from cache
                    let old_count = that.allFiles[file];
                    total = old_count ? (total - old_count) : total;
                    that.allFiles[file] ? delete that.allFiles[file] : null; //delete entry if exist
                }
                resolve(total);
            } catch (err) {
                reject(err);
            }
        })
    }

    // Count the number of magic words in the files
    async countMagicWords(files,magic_word,event=null) {
        let that = this;
    
        return new Promise(async (resolve,reject) => {
            let totalMagic = that.totalMagicWord; // have a copy of total magic word
            let totalFileReads = 0; // Total number of files to read

            files.forEach( async function(file) {
                try {
                    if (!(that.excludeFiles.includes(path.extname(file).toLowerCase()) && stat["size"] < 1073741824)) { //exclude
                        if (event && event == 'deleted') { // For delete, we don't need to read files, it will not exist
                            totalFileReads++;
                            totalMagic = await that.reUpdateCache(file, 0, event, totalMagic);
                        } else {
                            totalFileReads++;
                            if (fs.existsSync(file)) { //read file only if it exists
                                let text = await fsExtra.readFile(file);
                                let count = await that.searchWord(text.toString(),magic_word); // search for magic word
            
                                if (!event) { //initial scan
                                    that.allFiles[file] =  count ? count : 0;
                                    totalMagic = count ? (totalMagic + count) : totalMagic; //update total 
                                } else {
                                    totalMagic = await that.reUpdateCache(file, count, event, totalMagic);
                                }    
                            }
                        }
                        if (that.isReadComplete(totalFileReads) == true) { //If all the files are processed, return
                            resolve(totalMagic);
                        }
                    }
                } catch (err) {
                    reject(err);
                }
            })	
        })
    }

    // Scan the entire directory and make a cache of files and magic word count in it.
    async initialScan() {

        let that = this;
        let directory = this.directory; //dir to search
        let magic_word = this.magicWord; //magic word to search
        let timer = this.pollTimer; //use poll timer for rescan interval
        let failed = false; // flag to check the scan is failed
        let noFiles = false; //If no files in provided directory

        that.child_ready = false;
        that.completedFileReads=0; //reset
        that.allFiles = {}; //reset
        that.totalMagicWord = 0; //reset

        let start_time = new Date(); // start time of the run

        if(this.initialScanTimer) {
            clearTimeout(this.initialScanTimer);
            this.initialScanTimer=null;
        }

        // Collect the list of files in the directory
        try {
            let files = await this.collectFiles(directory);
            
            // start counting the magic words in the files
            if (files && files.length) {
                that.logger.debug(`initialScan: Total of ${files.length} matching files in the directory ${directory}`)
                try {
                    that.totalMagicWord = await that.countMagicWords(files,magic_word);
                    that.logger.debug(`initialScan: Magic word ${magic_word} count during intial scan : ${that.totalMagicWord}`);
                    that.child_ready = true; // make child ready for future change request
                } catch(err) {
                    that.logger.error(`initialScan: Error occured while counting magic word ${magic_word}, Error: ${err}`);
                    failed = true;
                    that.logger.debug(`initialScan: Retrying the scan after ${timer}ms'`)
                    that.initialScanTimer = setTimeout(that.initialScan.bind(that), timer); // Try rescan
                }
            } else {
                that.logger.debug(`initialScan: No matching files are found in directory ${directory}`)
                noFiles=true;
            }
        } catch (err) {
            that.logger.error(`initialScan: Error walking directory ${directory} , Error: ${err}`);
            failed = true;
            that.logger.debug(`initialScan: Retrying the scan after ${timer}ms'`)
            that.initialScanTimer = setTimeout(that.initialScan.bind(that), timer);  // Try rescan
        }

        let end_time = new Date();
        let total_time = (Math.abs(end_time - start_time) / 1000) % 60 //secs

        // Frame the result
        let result = {
            start : Math.floor(start_time / 1000),
            end : Math.floor(end_time / 1000),
            total : total_time,
            added : {added : failed ? {} : Object.keys(that.allFiles)},
            deleted : {deleted : {}},
            word : magic_word,
            word_count : that.totalMagicWord,
            status : failed ? 'failed' : 'success'
        }

        that.sendResultToParent(that.enums.child.RESULTS_READY,result); // send the result to parent

        if (!failed) { // if success, send child status as ready to parent and start periodic monitoring
            that.sendResultToParent(that.enums.child.CHILD_READY);

            that.monitorDirectory(); //start long running task
        }
    }

    //process file changes observed during the monitoring
    async processFileChanges(files,magic_word,event) {
        let that = this;
        return new Promise(async (resolve,reject) => {
            try {
                that.totalMagicWord = await that.countMagicWords(files,magic_word,event);
                that.logger.debug(`processFileChanges: Magic word ${magic_word} count during scan : ${that.totalMagicWord}`);
                resolve('done');
            } catch(err) {
                that.logger.error(`processFileChanges: Error occured while counting magic word ${magic_word}, Error: ${err}`);
                reject(err);
            }
        })
    }

    // To monitor the folder
    async monitorDirectory() {
        let that = this;

        let failed = false; // flag to check the scan is failed
        let magic_word = that.magicWord;
        let added = null;
        let changed = null;
        let deleted = null;
        let start_time = new Date();

        //reset to pickup new timer, in case of changes
        if (that.monitorTimer) {
            clearInterval(that.monitorTimer);
            that.monitorTimer = null;
        }

        try {
            //Init the watcher to watch for changes
            if (!that.watcher) {
                that.watcher = new folderWatcher(that.directory, that.logger);
                await that.watcher.start();
            }

            try {
                added = that.watcher.get_added_files();
                changed = that.watcher.get_changed_files();
                deleted  = that.watcher.get_deleted_files();
    
                added && added.length ? await that.processFileChanges(added,magic_word,'added') : null;
                changed && changed.length ? await that.processFileChanges(changed,magic_word,'changed') : null;
                deleted && deleted.length ? await that.processFileChanges(deleted,magic_word,'deleted') : null;
            } catch (err) {
                that.logger.error(`monitorDirectory: Error processing File changes, ${err}`);
                failed = true;
            }
        } catch (err) {
            that.logger.error(`monitorDirectory: Error initializing watcher, ${err}`);
            failed = true;
        }
        
        let end_time = new Date();
        let total_time = (Math.abs(end_time - start_time) / 1000) % 60 //secs

        // Frame the result
        let result = {
            start : Math.floor(start_time / 1000), //epoch time
            end : Math.floor(end_time / 1000),
            total : total_time,
            added : {added : added ? added : {}},
            deleted : {deleted : deleted ? deleted : {}},
            word : magic_word,
            word_count : that.totalMagicWord,
            status : failed ? 'failed' : 'success'
        }
        
        that.sendResultToParent(that.enums.child.RESULTS_READY,result); // send the result to parent
    
        if (failed) { // if failed, do full scanning again to get the latest updates and clear intermediate results
            that.restartInitialScan();
        }

        that.monitorTimer =  setInterval(that.monitorDirectory.bind(that), that.pollTimer);
    }
}

new statCollector();
