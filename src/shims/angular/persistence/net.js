/**
 * Copyright 2014 Kinvey, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// `Kinvey.Persistence.Net` adapter for [$http](http://docs.angularjs.org/api/ng.$http).
var AngularHTTP = {
  /**
   * @augments {Kinvey.Persistence.Net.request}
   */
  base64: function(value) {
    return root.btoa(value);
  },

  /**
   * Flag whether the device supports Blob.
   *
   * @property {boolean}
   */
  supportsBlob: (function() {
    // The latest version of the File API uses `new Blob` to create a Blob
    // object. Older browsers, however, do not support this and fall back to
    // using ArrayBuffer.
    try {
      return new root.Blob() && true;
    }
    catch(e) {
      return false;
    }
  }()),

  /**
   * @augments {Kinvey.Persistence.Net.encode}
   */
  encode: root.encodeURIComponent,

  /**
   * @augments {Kinvey.Persistence.Net.request}
   */
  request: function(method, url, body, headers, options) {
    // Cast arguments.
    body    = body    || {};
    headers = headers || {};
    options = options || {};
    options.attemptMICRefresh = false === options.attemptMICRefresh ? false : true;

    // Append header for compatibility with Android 2.2, 2.3.3, and 3.2.
// http://www.kinvey.com/blog/item/179-how-to-build-a-service-that-supports-every-android-browser
    if(0 === url.indexOf(Kinvey.APIHostName) && 'GET' === method) {
      var location = root.location;
      if(null != location && null != location.protocol) {
        headers['X-Kinvey-Origin'] = location.protocol + '//' + location.host;
      }
    }

    // Debug.
    logger.debug('Initiating a network request.', method, url, body, headers, options);

    // Initiate the request.
    if(isObject(body) && !(
     (null != root.ArrayBuffer && body instanceof root.ArrayBuffer) ||
     (null != root.Blob        && body instanceof root.Blob)
    )) {
      body = null != angular.toJson ? angular.toJson(body) : JSON.stringify(body);
    }

    // Create a proxy request
    var cancelDeferred = Kinvey.Defer.deferred();
    var requestProxy = {
      cancel: function() {
        cancelDeferred.resolve();
      }
    };

    // Setup the timeout
    if (options.timeout) {
      setTimeout(function() {
        requestProxy.cancel();
      }, options.timeout);
    }

    // Send the proxy request
    if (options.handler && typeof options.handler === 'function') {
      options.handler(requestProxy);
    }

    return $http({
      data    : body,
      headers : headers,
      method  : method,
      timeout : cancelDeferred,
      url     : url
    }).then(function(response) {
      var _response = response;

      // Debug.
      logger.debug('The network request completed.', response);

      // If `options.file`, convert the response to `Blob` object.
      response = response.data;
      if(options.file && null != response && null != root.ArrayBuffer) {
        // jQuery does not provide a nice way to set the responseType to blob,
        // so convert the response to binary manually.
        // https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/Sending_and_Receiving_Binary_Data
        var buffer  = new root.ArrayBuffer(response.length);
        var bufView = new root.Uint8Array(buffer);
        for(var i = 0, length = response.length; i < length; i += 1) {
          bufView[i] = response.charCodeAt(i);
        }

        // If possible, convert the buffer to an actual `Blob` object.
        if(AngularHTTP.supportsBlob) {
          buffer = new root.Blob([bufView], { type: options.file });
        }
        response = buffer;
      }

      // Success implicates 2xx (Successful), or 304 (Not Modified).
      var status = _response.status;

      // Check `Content-Type` header for application/json. Thrown error will
      // cause promise to be rejected.
      if (!options.file && url.indexOf('https://storage.googleapis.com') !== 0 && response != null && 2 === parseInt(status / 100, 10) && 204 !== status) {
        var responseContentType = _response.headers('Content-Type') || undefined;
        var error;

        if (responseContentType == null) {
          error = new Kinvey.Error('Content-Type header missing in response. Please add ' +
                                   'Content-Type header to response with value ' +
                                   'application/json.');
        }
        else if (responseContentType.indexOf('application/json') === -1) {
          error = new Kinvey.Error('Response Content-Type header is set to ' +
                                   responseContentType + '. Expected it to be set ' +
                                   'to application/json.');
        }

        if (error) {
          throw error;
        }
      }

      // Return the response.
      return response || null;
    }, function(response) {
      var promise;
      var originalRequest = options._originalRequest;

      // Debug.
      logger.error('The network request failed.', response);

      if (401 === response.status && options.attemptMICRefresh) {
        promise = MIC.refresh(options);
      }
      else {
        promise = Kinvey.Defer.reject();
      }

      return promise.then(function() {
        // Don't refresh MIC again
        options.attemptMICRefresh = false;
        // Resend original request
        return Kinvey.Persistence.Net._request(originalRequest, options);
      }, function() {
        var error = response.data || null;

        if (Array.isArray(error)) {
          error = new Kinvey.Error('Received an array as a response with a status code of ' + response.status + '. A JSON ' +
                                   'object is expected as a response to requests that result in an error status code.');
        }

        return Kinvey.Defer.reject(error);
      });
    });
  }
};

// Use Angular adapter.
Kinvey.Persistence.Net.use(AngularHTTP);
