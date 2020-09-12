const fs = require('fs');
const path = require('path');

const common = require('./lib/common');
const config = require('./lib/config');
const logger = require('./lib/logger.js')

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
        this.magicTotal = 0; // Total number of magic words
        this.initialScanTimer = null; //Rescan timer in case of initial scan failure
        this.

        this.child_ready = false; //child will be ready to accept change request from parent only if initial scan is completed
    
        //IPC event messages
        this.enums = config.ipc_messages;

        // logging options
        const LOG_FILE = config.DEFAULT_LOG_DIR + 'child_'+ process.pid + '_' + common.getIsoTime() + '.log';

        let childName = 'child_'+process.pid;

        let logParams = {
            level : this.logLevel,
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
                that.handleChanges(msg);
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

    // process all the incoming msg from parent and act accordingly
    handleChanges(msg) {
        switch (msg.type) {
            case this.enums.parent.CHANGE_POLL_INTERVAL :
                this.pollTimer = msg.data;
                this.logger.debug(this.pollTimer);
                break;
            case that.enums.parent.CHANGE_MAGIC_WORD :
                this.magicWord = msg.data;
                this.logger.debug(this.magicWord);
                break;
            case that.enums.parent.CHANGE_DIR_SETTINGS :
                this.directory = msg.data;
                this.logger.debug(this.directory);
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

    // Collect and send back list of files
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
                let pattern = new RegExp("\\b" + find + "\\b", 'g')
                let r = text.match(pattern)
                resolve(r && r.length);
            } catch (err) {
                reject(err)
            }
        })
    };

    // Count the number of magic words in the files
    async countMagicWords(files,magic_word) {
        let that = this;
    
        return new Promise(async (resolve,reject) => {
            let totalMagicWord = 0;
            let totalFileReads = 0; // Total number of files to read
            try {
                files.forEach( function(file) {
                    totalFileReads++;
                    fs.readFile(file, 'utf-8', async function(err, text) {
                        if (err) {
                            reject(err);
                        }
                        else {
                            let count = await that.searchWord(text,magic_word); // search for magic word

                            that.allFiles[file] =  count ? count : 0;
                            totalMagicWord = count ? totalMagicWord + count : totalMagicWord;
                            if (that.isReadComplete(totalFileReads) == true) {
                                resolve(totalMagicWord);	
                            }	
                        }
                    });
                })	
            } catch (err) {
                reject(err);
            }
        })
    }

    // Scan the entire directory and make a cache of files and magic word count in it.
    async initialScan() {

        let that = this;
        let directory = this.directory; //dir to search
        let magic_word = this.magicWord; //magic word to search
        let timer = this.pollTimer;
        let failed = false; // flag to check the scan is failed
        let noFiles = false; //If no files in provided directory

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
                    that.magicTotal = await that.countMagicWords(files,magic_word);
                    that.logger.debug(`initialScan: Magic word ${magic_word} count during intial scan : ${that.magicTotal}`);
                    that.child_ready = true; // make child ready for future change request
                } catch(err) {
                    that.logger.error(`initialScan: Error occured while counting magic word ${magic_word}, Error: ${err}`);
                    failed = true;
                    that.child_ready = false;
                    that.completedFileReads=0; //reset
                    that.allFiles = {}; //reset
                    that.magicTotal = 0; //reset
                    that.logger.debug(`initialScan: Retrying the scan after ${timer}ms'`)
                    that.initialScanTimer = setTimeout(that.initialScan.bind(that), timer); // Try rescan
                }
            } else {
                that.logger.debug(`initialScan: No files are found in directory ${directory}`)
                noFiles=true;
            }
        } catch (err) {
            that.logger.error(`initialScan: Error walking directory ${directory} , Error: ${err}`);
            failed = true;
            that.child_ready = false;
            that.completedFileReads=0; //reset
            that.allFiles = {}; //reset
            that.magicTotal = 0; //reset
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
            word_count : that.magicTotal,
            status : failed ? 'failed' : 'success'
        }

        that.sendResultToParent(that.enums.child.RESULTS_READY,result); // send the result to parent

        if (!failed) { // if success, send child status as ready to parent
            that.sendResultToParent(that.enums.child.CHILD_READY)
        }
    }
}

new statCollector();
