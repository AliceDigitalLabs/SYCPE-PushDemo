(function () {
  'use strict';

  angular
    .module('main' )
    .controller('mainCtrl', mainCtrl);

  mainCtrl.$inject = [
    '$ionicPlatform',
    '$scope',
    '$state',
    '$sce',
    '$http',
    'pushSrvc',
    'uuid'
  ];
2
  function mainCtrl(
    $ionicPlatform,
    $scope,
    $state,
    $sce,
    $http,
    pushSrvc,
    uuid
  ) {

    var vm=angular.extend(this, {

    });

    vm.isRescuer = false;
    vm.isRescuee = false;

    vm.role = undefined;
    vm.otherRole = undefined;

	  vm.ROLES = { RESCUER : 0,
			  	       RESCUEE : 1 };
	  vm.ROLE_STRINGS = [ "Rescuer",
						            "Rescuee" ];
	  vm.MESSAGE_TYPE_ID = { ACK : 0,
						               NACK : 1,
						               CONNECTION_REQUEST: 2,
						               CONNECTION_RESPONSE: 3,
						               MESSAGE: 4 };
	  vm.ACTIVITY = { SHOW: 1,
					          SCAN: 2 };
	  vm.MESSAGE_TIMEOUT_SECONDS = 10;

    vm.pushConnected = false;
    vm.activity = 0;
    vm.registrationId = "";

    vm.uuid = false;

    vm.inbound = { data: { },
                   rendered: "No messages yet." };

    vm.subscriptionFeedback = "";

    vm.initialise = function initialise() {

      vm.inbound.rendered = "No registrationId yet...";

      pushSrvc.initialisePush( function deviceNowConnected( data ){
        console.log("controller initialised push, got payload ",data );
        vm.inbound.rendered = "Got connected payload";
        if (data.hasOwnProperty('registrationId')===true) {

          vm.registrationId = data.registrationId;
          vm.pushConnected = true;

          pushSrvc.setCallback( vm.handleInbound );
          pushSrvc.setTimeout( vm.MESSAGE_TIMEOUT_SECONDS * 1000 );
        }
      });
    };

    vm.setRescuer = function setRescuer( ) {
      console.log("setting as rescuer");
      vm.role = vm.ROLES.RESCUER;
      vm.otherRole = vm.ROLES.RESCUEE;
      vm.activity = vm.ACTIVITY.SHOW;
    };

    vm.setRescuee = function setRescuee( ) {
      console.log("setting as rescue*e*");
      vm.role = vm.ROLES.RESCUEE;
      vm.otherRole = vm.ROLES.RESCUER;
      vm.activity = vm.ACTIVITY.SCAN;
    };

    vm.startCodeScan = function startCodeScan() {
      console.log("starting a QR code scan");
      cordova.plugins.barcodeScanner.scan(
        function(qrResult) { // .text .format .cancelled
          console.log("scanned",qrResult);
          if(qrResult.cancelled===true) {
            console.log("aborted scan!");
            return;
          } else {
            if(qrResult.format==="QR_CODE") {
              var temp_uuid = uuid.v4();
			        // request a connection uuid
              var connection_payload = {
                method: 'POST',
                url: pushSrvc.SERVER_ROOT + "/connections",
                headers: {
                  'Content-Type':'application/json'
                },
                data: {
                  'id': temp_uuid
                }
              };
              console.log("requesting connection ID creation - sending ", connection_payload );
			        $http( connection_payload )
			  	      .success(
			  		      function(data, status, headers, config) {
			  		        // we have a connection uuid in data .id
			  		        console.log("id: "+data.id, data);

			  		        vm.temp_uuid = data.id; 

                    //vm.connection_request_uuid =  uuid.v4();

			  		        // construct a outbound messag
			  		        var payload = { 
			  			        connection_id: data.id,
			  			        sender_id: vm.registrationId,
			  			        message_id: temp_uuid, 
			  			        message_type: vm.MESSAGE_TYPE_ID.CONNECTION_REQUEST,
			  			        sender_role: vm.role,
			  			        payload: qrResult.text,
			  			        payload_format_type: 0
			  		        };
					          pushSrvc.sendPayload( payload ).then(function sentPayloadOkay(data){
						          console.log('initial connection - sent, got', payload, data);
                    }, function errorPayloadSend( error ) {
						          console.log('initial connection - failed send, error', payload, error);
					          });
			  	        }).error( function(error) {
			  		        // failed to get connection uuid from the server
			  		        alert("Failed requesting a connection UUID.");
		  		        });
            }
          }
        },
        function(error) {
          console.log("error scanning",error);
        },
        {
          showTorchButton: false,
          saveHistory: false,
          prompt: "Scan the Rescuer's Code"
        }
      );
    };

    vm.handleInbound = function handleInbound( data ) {
      console.log("got inbound message", data);
      angular.merge( vm.inbound.data, data.payload );
      vm.inbound.rendered = JSON.stringify(vm.inbound.data);

      if(data.hasOwnProperty("payload")) {
        var payload = data.payload;
        // is this a connection request?
        if (payload.message_type === vm.MESSAGE_TYPE_ID.CONNECTION_REQUEST) {
          // connection request! send back a confirmation
          var responsePayload = {
            connection_id: payload.connection_id,
            sender_id: vm.registrationId,
            recipient_id: payload.sender_id,
            message_id: payload.message_id,
            message_type: vm.MESSAGE_TYPE_ID.CONNECTION_RESPONSE,
            sender_role: vm.role,
            payload: payload.payload,
            payload_format_type: 0
          };
          pushSrvc.sendPayload( responsePayload ).then( function sendPayloadOkay(indata) {
            console.log('intial connection confirmation sent okay - got ',indata );
            vm.uuid = payload.connection_id;
          }, function failedSending(err) {
            console.log('error sending first message - ',err);
          });
        }
        if (payload.message_type === vm.MESSAGE_TYPE_ID.CONNECTION_RESPONSE) {
          // this is the confirmation of the other user
          vm.uuid = payload.connection_id;
        }
      }


      if(data.hasOwnProperty("additionalData")) {
        if(data.event === "rescuee_start") {
          window.localStorage.setItem("role","rescuer");
          // log our UUID
          console.log("got sharedUuid of "+data.sharedUuid);
          window.localStorage.setItem("uuid", data.sharedUuid);
          vm.uuid = data.sharedUuid;

          // compose an ack message back
          pushSrvc.send( data.rescuer_device_id,
                         "acknowledgement_from_rescuer",
                         { rescuee_device_id:vm.registrationId,
                           "sharedUuid":data.sharedUuid,
                           event:"ack_from_rescuer" } );

          vm.startSubscription("rescuer");
        }
        if(data.event === "ack_from_rescuer") {
          // do our UUIDs match?
          if( window.localStorage.getItem("uuid")===data.sharedUuid ) {
            alert("UUIDs match, good to go");
            vm.uuid = window.localStorage.getItem("uuid");
            window.localStorage.setItem("role","rescuee");

            vm.startSubscription("rescuee");

          } else {
            alert("Error: Mismatched UUIDs!");
            console.log("stored UUID",window.localStorage.getItem("uuid"));
            console.log("roundtripped UUID",data.sharedUuid);
          }
          // pof
          //alert("ack back");
        }
      }
    };

    vm.startSubscription = function startSubscription( role ) {
      //alert("NO I AM NOT SUBSCRIBING");
      // subscribe to "vm.uuid/role"
      var topic = vm.uuid + "_" + role;
      console.log( "subscribing to " + topic );
      pushSrvc.subscribe( topic, function() {
      } );
    };
    vm.pingRescuer = function pingRescuer() {
      pushSrvc.sendToTopic( vm.uuid + "_" + "rescuer", "from the rescuee", {"message":"hello from rescuee" } );
    };
    vm.pingRescuee = function pingRescuee() {
      pushSrvc.sendToTopic( vm.uuid + "_" + "rescuee", "from the rescuer", {"message":"hello from rescuer" } );
    };
    vm.initialise();

  }
})();
