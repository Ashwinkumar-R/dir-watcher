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

        //start monitoring the directory and collecting results
        this.monitorDir();

        //handle messages to/from parent
        process.on('message', async (msg) => { 
            that.logger.debug(`Received message from parent. Type: ${msg.type}`);

            if (msg.type in Object.keys(that.enums.parent)) {
                that.processMessage(msg);
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
    processMessage() {
        switch (msg.type) {
            case that.enums.parent.CHANGE_POLL_INTERVAL :
                that.logger.debug(msg.data);
                break;
            case that.enums.parent.CHANGE_MAGIC_WORD :
                that.logger.debug(msg.data);
                break;
            case that.enums.parent.CHANGE_DIR_SETTINGS :
                that.logger.debug(msg.data);
                break;
        }
    }

    // update the changes
    handleChanges() {

    }

    async monitorDir() {
        let that = this;

        let start = new Date();
        let end = new Date();
        let total = (Math.abs(end - start) / 1000) % 60
        let result = {
            start : Math.floor(start / 1000),
            end : Math.floor(end / 1000),
            total : total,
            added : {added : ['abc.txt']},
            deleted : {deleted : ['abx1.log']},
            word : 'hello',
            word_count : 1,
            status : 'success'
        }
        process.send({type:that.enums.child.RESULTS_READY, results : result})
    }

}

new statCollector();
