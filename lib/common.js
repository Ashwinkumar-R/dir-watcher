function getIsoTime() {
    return (new Date().toISOString().replace(/-/g,'_').replace(/T/,'_').replace(/:/g,'').replace(/\..+/, ''));
}

//Helper function - sleep equivalent
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

// wrapper for "await" promise for easy handling of errors; usage: [err,data] = await to(asyncfunc) 
function to(promise) {
    return promise.then(data => {
      return [null, data];
    })
      .catch(err => [err]);
};

function getProperty() {

}

function setProperty() {
  
}


module.exports.getIsoTime = getIsoTime;
module.exports.sleep = sleep;
module.exports.to = to;