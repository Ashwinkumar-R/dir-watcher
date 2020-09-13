/*****************************************************************************************************/
/* file : logger.js
/* author : Ashwinkumar R
/* 
/* This file is responsible for creating logger to log messages to console and file.
/*
/*****************************************************************************************************/

const log4js = require('log4js');

class logger {
	constructor(params) {

		this.params = params;

		// set the log this.params
		let level = this.params && this.params.level || 'info'; // Log levels: ALL < TRACE < DEBUG < INFO < WARN < ERROR < FATAL < MARK < OFF
		let maxLogSize = this.params && this.params.maxLogSize || undefined; // by default do not roll log (value provided in bytes)
		let appName = this.params && this.params.name || 'DirWatcher';
		let file = this.params && this.params.logFile || 'DirWatcher.log'

		let aps = {};
		aps['output'] = { type: 'console'};
		let apsList = ['output'];

		if (level !== 'off') {
			aps['file'] = { type: 'file', filename: file, flags: "w", maxLogSize: maxLogSize};
			apsList.push('file');
		}

		log4js.configure({
			appenders: aps,
			categories: { default: { appenders: apsList, level: level } }
		});
	
		return log4js.getLogger(appName.toString());
	}
}

module.exports = logger;