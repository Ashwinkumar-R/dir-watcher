/**********************************************************************************************/
/* file : main.js
/* author : Ashwinkumar R
/* 
/* This is the main entry point for the file to parse the command line arguments
/* and update required configuration options.
/* It starts the main server module.
/*
/* Usage: node main.js -level <Log level> -dbhost <DB Host> -dbport <DB port> -dbuser <DB user>
/*          -dbpass <DB password> -dbname <DB name> -dbtable <DB table> -poll <Polling timer>
/*          -magic <Magic word> -dir <Folder to monitor> -port <Application port>
/*
/* NOTE: except -dbpass all other parameters are optional.
/*
/***********************************************************************************************/

const common = require('./lib/common');
const config = require('./lib/config');
const dirWatcher = require('./server');

function main() {
    let options = config.options;

    if(process.argv.length > 2) {
        console.log(`Received command line arguments`)
    }

    //parse the arguments
    for (var i=0; i < process.argv.length; i++) {
        var key = process.argv[i];
        var value = process.argv[i+1];
    
        if (key) {
            switch (key) {
                case '-level':
                    options.log.level = value;
                    break;
                case '-dbhost':
                    options.db_params.dbhost = value;
                    break;
                case '-dbport':
                    options.db_params.dbport = value;
                    break;
                case '-dbuser':
                    options.db_params.dbuser = value;
                    break;
                case '-dbpass':
                    options.db_params.dbpass = value;
                    break;
                case '-dbname':
                    options.db_params.dbname = value;
                    break;
                case '-dbtable':
                    options.db_params.dbtable = value;
                    break;
                case '-poll':
                    options.monitor.pollTime = value;
                    break;
                case '-magic':
                    options.monitor.magicWord = value;
                    break;
                case '-dir':
                    options.monitor.directory = value;
                    break;
                case '-port':
                    options.app.appPort = value;
                    break;
            }
        }
    }

    //call main server module
    new dirWatcher(options);
}

main();

process.on('unhandledRejection', (err, p) => {
    console.warn('main: unhandledRejection', err, p);
});
