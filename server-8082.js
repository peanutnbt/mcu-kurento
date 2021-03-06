var kurento = require("kurento-client");
var express = require("express");
var app = express();
var path = require("path");
var wsm = require("ws");
var https = require("https");
var fs = require("fs");
app.set("port", process.env.PORT || 8082);

/*
 * Definition of constants
 */

// Modify here the kurento media server address
//const ws_uri = "ws://117.5.229.85:10000/kurento";
// const ws_uri = "ws://192.168.15.45:8889/kurento";
const ws_uri = "ws://localhost:8889/kurento";

/*
 * Definition of global variables.
 */

var composite = null;
var mediaPipeline = null;

var idCounter = 0;
var clients = {};
var candidatesQueue = {};
var kurentoClient = null;

function nextUniqueId() {
  idCounter++;
  return idCounter.toString();
}

var options = {
  key: fs.readFileSync("cert.key"),
  cert: fs.readFileSync("cert.pem"),
};

/*
 * Server startup
 */

var port = app.get("port");
// var server = app.listen(port, function()
// {
//     console.log('Mixing stream server started');
// });

var server = https.createServer(options, app).listen(8082);
console.log("-----SERVER 2-----")

var WebSocketServer = wsm.Server;
var wss = new WebSocketServer({
  server: server,
  path: "/call",
});

/*
 * Management of WebSocket messages
 */
wss.on("connection", function (ws) {
  var sessionId = nextUniqueId();

  console.log("Connection received with sessionId " + sessionId);

  ws.on("error", function (error) {
    console.log('---------------Connection ' + sessionId + ' error');
    stop(sessionId);
  });

  ws.on("close", function () {
    console.log('---------------Connection ' + sessionId + ' closed');
    stop(sessionId);
  });

  ws.on("message", function (_message) {
    var message = JSON.parse(_message);
    // console.log('-----------------------------------------------------message id',message.id);
    // console.log('Connection ' + sessionId + ' received message ', message.id);

    switch (message.id) {
      case "client":
        // console.log(message.sdpOffer)
        addClient(ws, sessionId, message.sdpOffer, function (error, sdpAnswer) {
          if (error) {
            console.log(error);
            return ws.send(
              JSON.stringify({
                id: "response",
                response: "rejected",
                message: error,
              })
            );
          }
          // console.log("sdp: ", message.sdpOffer)
          ws.send(
            JSON.stringify({
              id: "response",
              response: "accepted",
              sessionId: sessionId,
              sdpAnswer: sdpAnswer,
            })
          );
        });
        break;

      case "stop":
        stop(sessionId);
        break;

      case "stop_by_jitsi":
        // console.log("stop_by_jitsi: ", message)
        stop(message.sessionId);
        break;

      case "stop_sfu":
        // console.log("sessionId: ",message.sessionId)
        stop(message.sessionId);
        break;

      case "onIceCandidate":
        // console.log("-------------------------------",message.candidate)
        // console.log("00000000000000000000onIceCandidate000000000000000000000");
        if (message.candidate) {
          var test = {
            candidate: message.candidate.candidate,
            sdpMid: message.candidate.sdpMid,
            sdpMLineIndex: message.candidate.sdpMLineIndex,
            usernameFragment: message.candidate.usernameFragment,
          };
          // console.log("---------------------test: ", sessionId);
          onIceCandidate(sessionId, test, ws);
        }
        break;

      default:
        ws.send(
          JSON.stringify({
            id: "error",
            message: "Invalid message " + message,
          })
        );
        break;
    }
  });
});

/*
 * Definition of functions
 */

// Retrieve or create kurentoClient
function getKurentoClient(callback) {
  // console.log("getKurentoClient");
  if (kurentoClient !== null) {
    // console.log("KurentoClient already created");
    return callback(null, kurentoClient);
  }

  kurento(ws_uri, function (error, _kurentoClient) {
    // console.log("creating kurento");
    if (error) {
      // console.log("Coult not find media server at address " + ws_uri);
      return callback(
        "Could not find media server at address" +
        ws_uri +
        ". Exiting with error " +
        error
      );
    }
    kurentoClient = _kurentoClient;
    callback(null, kurentoClient);
  });
}

// Retrieve or create mediaPipeline
function getMediaPipeline(callback) {
  if (mediaPipeline !== null) {
    // console.log("MediaPipeline already created");
    return callback(null, mediaPipeline);
  }
  getKurentoClient(function (error, _kurentoClient) {
    if (error) {
      return callback(error);
    }
    _kurentoClient.create("MediaPipeline", function (error, _pipeline) {
      if (error) {
        return callback(error);
      }
      mediaPipeline = _pipeline;
      callback(null, mediaPipeline);
    });
  });
}

// Retrieve or create composite hub
function getComposite(callback) {
  if (composite !== null) {
    // console.log("Composer already created");
    return callback(null, composite, mediaPipeline);
  }
  getMediaPipeline(function (error, _pipeline) {
    if (error) {
      return callback(error);
    }
    _pipeline.create("Composite", function (error, _composite) {
      // console.log("creating Composite");
      if (error) {
        return callback(error);
      }
      composite = _composite;
      callback(null, composite);
    });
  });
}

// Create a hub port
function createHubPort(callback) {
  getComposite(function (error, _composite) {
    if (error) {
      return callback(error);
    }
    _composite.createHubPort(function (error, _hubPort) {
      // console.info("Creating hubPort");
      if (error) {
        return callback(error);
      }
      callback(null, _hubPort);
    });
  });
}

// Create a webRTC end point
function createWebRtcEndPoint(callback) {
  getMediaPipeline(function (error, _pipeline) {
    if (error) {
      return callback(error);
    }
    _pipeline.create("WebRtcEndpoint", function (error, _webRtcEndpoint) {
      // console.info("Creating createWebRtcEndpoint");
      if (error) {
        return callback(error);
      }
      callback(null, _webRtcEndpoint);
    });
  });
}

// Add a webRTC client
function addClient(ws, id, sdp, callback) {
  createWebRtcEndPoint(function (error, _webRtcEndpoint) {
    if (error) {
      // console.log("Error creating WebRtcEndPoint " + error);
      return callback(error);
    }
    // console.log("----------------");
    // console.log(_webRtcEndpoint)
    // console.log("----1", candidatesQueue?.[id]?.[0]);
    // console.log("----2", id);
    if (candidatesQueue[id]) {
      // console.log(5);
      while (candidatesQueue[id].length) {
        var candidate = candidatesQueue[id].shift();
        //  console.log("shift: ", candidate);
        _webRtcEndpoint.addIceCandidate(candidate);
      }
      clients[id] = {
        id: id,
        webRtcEndpoint: null,
        hubPort: null,
      };
    }
    clients[id].webRtcEndpoint = _webRtcEndpoint;
    clients[id].webRtcEndpoint.on("OnIceCandidate", function (event) {
      // console.log(4);
      // console.log(event.candidate)
      var candidate = kurento.register.complexTypes.IceCandidate(
        event.candidate
      );
      // console.log("--------------------------aaaa: ", candidate)
      ws.send(
        JSON.stringify({
          id: "iceCandidate",
          candidate: candidate,
        })
      );
    });

    clients[id].webRtcEndpoint.processOffer(sdp, function (error, sdpAnswer) {
      // console.log(2);
      if (error) {
        stop(id);
        // console.log("Error processing offer " + error);
        return callback(error);
      }
      callback(null, sdpAnswer);
    });

    clients[id].webRtcEndpoint.gatherCandidates(function (error) {
      // console.log(3);
      if (error) {
        return callback(error);
      }
    });
    // console.log(clients[id])

    createHubPort(function (error, _hubPort) {
      // console.log(1);

      // console.log("clientid hubport: ", clients[id]);

      if (error) {
        stop(id);

        return callback(error);
      }
      clients[id].hubPort = _hubPort;
      clients[id].webRtcEndpoint.connect(clients[id].hubPort);
      clients[id].hubPort.connect(clients[id].webRtcEndpoint);
    });
  });
}

// Stop and remove a webRTC client
function stop(id) {
  if (clients[id]) {
    if (clients[id].webRtcEndpoint) {
      clients[id].webRtcEndpoint.release();
    }
    if (clients[id].hubPort) {
      clients[id].hubPort.release();
    }
    delete clients[id];
  }
  if (Object.getOwnPropertyNames(clients).length == 0) {
    if (composite) {
      composite.release();
      composite = null;
    }
    if (mediaPipeline) {
      mediaPipeline.release();
      mediaPipeline = null;
    }
  }
  delete candidatesQueue[id];
}

function onIceCandidate(sessionId, _candidate, ws) {
  var candidate = kurento.register.complexTypes.IceCandidate(_candidate);
  // console.log("-----candidate:", candidate)
  // console.log("-----0: ", sessionId);
  // console.log("-----01: ", clients?.[sessionId]?.id);
  // console.log("-----001: ", candidate);
  if (candidate.candidate == '') {
    // console.log("-----------------------END ICE---------------------")
    ws.send(
      JSON.stringify({
        id: "endCandidate",
      })
    );
  }
  if (clients[sessionId]) {
    // console.info('Sending candidate');
    // console.log("---in clients");
    var webRtcEndpoint = clients[sessionId].webRtcEndpoint;
    webRtcEndpoint.addIceCandidate(candidate);
  } else {
    // console.info('Queueing candidate');
    // console.log("---in candidatesQueue");

    if (!candidatesQueue[sessionId]) {
      candidatesQueue[sessionId] = [];
    }
    // console.log("addIce: ",candidate)

    candidatesQueue[sessionId].push(candidate);
  }
}
app.use(express.static(path.join(__dirname, "static")));
