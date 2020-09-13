# DirWatcher

> This is an utility to monitor the files in the configured folder.

## Requirement of this project

```sh

    Create long running background task which will monitor the configured directory at a scheduled interval of configured time. This task will read all the contents of files in the directory and will count the occurrences of configured magic string and save it as a result in the database against that run. It will also note down any new files added and any files got deleted also.

    By doing the REST API call we should able to change configuration of Directory that needs to be monitored, time interval of the background task, magic string to be searched.

    Task run details should be fetched via REST API. Result should contain each task start time, end time, total runtime, files added list, files deleted list and the total number of occurrences of magic string in all files and the status of task like whether it is success or failed or in progress.

```

## Functionalities

```sh
## Two main modules (server(parent) and background task(child))

# server

    - Creates and monitor DB connection to postgres DB and send/receive all requests/responses to/from DB module
    - Creates Express server and required endpoints
    - Fork the background task(child) and handles IPC
    - Handles incoming change request via API and send them to child

# background task

    - Runs a timer based scanning task to monitor configured folder
    - Handle IPC messages from parent
    - scan thorugh folders and collect details about the files and magic word count
    - Collect changed files from watcher module and update the magic word count
    - Frame and send task run result to parent to insert in DB
```

## System requirements

```sh

# node version
    - 10+

# npm version
    - 6+

# postgres server

    - 10 or 11

```

# installation

```sh

# clone the repository
    - git clone git@github.com:Ashwinkumar-R/dir-watcher.git

# cd to project
    - cd dir-watcher

# npm install
    - npm install

# start

    - node main.js <arguments>

```
# create table(optional)

```sh

## If the table is not available it will be created during startup, else you can create and make it available


# sample command
CREATE TABLE watcher (
	start_time timestamp(3) with time zone,
    end_time timestamp(3) with time zone,
    run_time_secs numeric,
    files_added jsonb,
    files_deleted jsonb,
    magic_word varchar(255),
    magic_word_count integer,
    run_status varchar(20)
);
```
# logging

```sh

2 log files will be created. One for parent and one for child. Optionally, log rotation can also be enabled.

```