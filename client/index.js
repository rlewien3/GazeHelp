/**
 * Client side for the CEP Photoshop Extension GazeHelp
 * Created by Ryan Lewien
 * 746528
 * 
 * By handling the websocket interaction and basic front end controls of the plugin,
 * this program interacts with the accompanying host program to implement three 
 * gaze-assisting features:
 * 
 * *** 1: QuickTool, a gaze-triggered popup that allows the user to select their
 *        next tool with gaze,
 * *** 2: X-Ray, providing the user a circular window a selected underlying layer, 
 *        the position of which is selected with the eyes,
 * *** 3: Privacy Shield, dimming and blocking the current art board from view when 
 *        looking away from the screen.
 * 
 * This project was completed for the HCI Project (INFO90008) at the University of Melbourne.
 * 
 * Debug with: chrome://inspect/#devices
 * Make sure port forwarding is set up to 8088
 */
let csInterface = new CSInterface();
let isLocked = false;

// Keep track of active feature
let QUICK_TOOL = 0;
let XRAY = 1;
let PRIVACY_SHIELD = 2;
let activeFeature;

// the screen's resolution dimensions, initialised from the GazeHelpServer
let screenDimensions = {
  width: 0,
  height: 0,
  scaleFactor: 1.5,
  isSet: false
};

/***************************************************************************************
 *
 *                                Websocket Interaction
 *
 **************************************************************************************/

let port = 8898;
let ws;
window.addEventListener("load", init, false);

/**
 * Initialises the connection with the GazeHelpServer
 */
function init() {

  // Start WebSocket
  writeToScreen("Connecting to server...");
  ws = new WebSocket("ws://localhost:" + port);
  ws.onmessage = onMessage;
  ws.onclose = onClose;
  ws.onerror = onError;
  ws.onopen = (e) => clearWriting();

  hideReconnectButton();
  
  // start with quicktool active
  //startQuickTool();
  startXray();
}

/**
 * Updates the plugin when new data is received from GazeHelpServer
 */
function onMessage(evt) {
  let msg = JSON.parse(evt.data);

  // update information from the host
  updateActiveFeature();
  updatePort();

  
  if (msg.type === 'gazePoint' && !isLocked) {
    // New gaze point arrived!

    let x = parseFloat(msg.data.X);
    let y = parseFloat(msg.data.Y);

    // determine which feature gets updated
    switch (activeFeature) {
      case QUICK_TOOL:
        updateQuickTool(x, y);  
        break;
      case XRAY:
        updateXray(x, y);
        break;
    }

  } else if (msg.type === 'state') {

    msg = msg.data;
    
    if (activeFeature == PRIVACY_SHIELD && !isLocked) {
      updatePrivacyShield(msg.gazeTracking === 'GazeTracked', msg.userPresence === 'Present');
    }

    if (!screenDimensions.isSet) {
      // Initialise the screen dimensions
      screenDimensions.width = msg.screenBounds.Width;
      screenDimensions.height = msg.screenBounds.Height;
      screenDimensions.scaleFactor = 1.5;

      // Initialise trigger location
      triggerLoc.width = triggerSizes.medium.width * screenDimensions.scaleFactor;
      triggerLoc.height = triggerSizes.medium.height * screenDimensions.scaleFactor;
      triggerLoc.x = screenDimensions.width - triggerSizes.medium.width * screenDimensions.scaleFactor;
      triggerLoc.y = screenDimensions.height - triggerSizes.medium.height * screenDimensions.scaleFactor;

      csInterface.evalScript(`setScreenDimensions("${screenDimensions.width}", "${screenDimensions.height}", "${screenDimensions.scaleFactor}")`);
      screenDimensions.isSet = true;
    }
  } else if (isLocked) {
    closeTrigger();
  }
}

/**
 * Handle disconnecting from GazeHelpServer
 */
function onClose(evt) {
    writeToScreen("Not connected to GazeHelpServer.");
    showReconnectButton();
}

/**
 * Handle WebSocket error occurring
 */
function onError(evt) {
    writeToScreen('Error: ' + evt.data);
}


/***************************************************************************************
 *
 *                                  Quick Tool
 *
 **************************************************************************************/

let isTriggered = false;
let isOpen = false;

// Default to disabled, until initialised with screenDimensions
let triggerLoc = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
}

// default range of trigger sizes
let triggerSizes = {
  small: {
    title: "Small",
    width: 200,
    height: 120
  },
  medium: {
    title: "Medium",
    width: 300,
    height: 180
  },
  large: {
    title: "Large",
    width: 400,
    height: 220
  }
}

/**
 * Creates the QuickTool front end in the plugin panel
 */
function startQuickTool() {
  $('#output').html('<img src="./images/quicktool-icon.svg" id="icon"/>')
  activeFeature = QUICK_TOOL;
}

/**
 * Updates the QuickTool panel with the new gaze point data
 */
function updateQuickTool(x, y) {
  
  checkHighlight(x, y);
  updateTriggerLoc();

  // update the popup's gaze coordinates
  if (isTriggered) {
    csInterface.evalScript(`updatePopup("${y}")`);
    updateStatus();
  }
}

/**
 * Updates the trigger location from host
 * No event for closing the settings panel, so just have to keep updating
 */
function updateTriggerLoc() {
  csInterface.evalScript("getTriggerLoc()", 
    function(newLocStr) { 
      
      if (newLocStr) {
        let newLoc = newLocStr.split(',');

        triggerLoc.x = Number(newLoc[0]);
        triggerLoc.y = Number(newLoc[1]);
        triggerLoc.width = Number(newLoc[2]) * screenDimensions.scaleFactor;
        triggerLoc.height = Number(newLoc[3]) * screenDimensions.scaleFactor;
      }
    }
  );
}


/**
 * Highlights the QuickTool panel if looking at it, to show it's been triggered
 */
function checkHighlight(x, y) {

  // make sure within trigger bounds
  if (x > triggerLoc.x && x < triggerLoc.x + triggerLoc.width &&
      y > triggerLoc.y && y < triggerLoc.y + triggerLoc.height) {
    
    startTrigger();
  
  // check outside screen if against edge
  } else if (((x > triggerLoc.x && triggerLoc.x + triggerLoc.width >= screenDimensions.width)
          || (x < triggerLoc.x + triggerLoc.width && triggerLoc.x == 0))
          && ((y > triggerLoc.y && triggerLoc.y + triggerLoc.height >= screenDimensions.height)
          || (y < triggerLoc.y + triggerLoc.height && triggerLoc.y == 0))) {
    startTrigger();
  } else {
    // double check it's not open
    if (!isOpen) {
      stopTrigger();
    }
  }
}

/**
 * Shows the trigger
 */
function startTrigger() {
  //highlight trigger
  $("#output").css('background-color', '#4D4D4D');
  
  if (!isTriggered) {
    openTrigger();
  }
}

/**
 * Stops the trigger
 */
function stopTrigger() {
  $("#output").css('background-color', '#434343');
  
  if (isTriggered) {
    closeTrigger();
  }
}

/**
 * Tells host to create trigger window
 */
function openTrigger() {
  
  // Double check the location is set correctly, not waiting for updates
  if (screenDimensions.isSet) {
    csInterface.evalScript(`openTrigger()`);
    isTriggered = true;
  }
}

/**
 * Tells host to close the trigger window
 */
function closeTrigger() {
  csInterface.evalScript(`closeTrigger()`);
  isTriggered = false;
  isOpen = false;
}

/**
 * Keeps track of the popup's status (open, triggered, closed)
 */
function updateStatus() {

  csInterface.evalScript("getStatus()", 
    function(returned) {

      if (returned === 'open') {
        isOpen = true;
      } else if (returned === 'triggered') {
        isTriggered = true;
      } else if (returned === 'closed') {
        isOpen = false;
        isTriggered = false;
      }
    });
}


/***************************************************************************************
 *
 *                                        X Ray
 *
 **************************************************************************************/

let timerFinished = true;
let xrayIsUpdating = false;
let xrayDiameter = 200;

/**
 * Creates the X-Ray front end in the plugin panel
 */
function startXray() {
  $('#output').html(
    '<button title="Click and hold to shift the X-Ray spot" id="xray-button" onmousedown="activateCrosshairs()" onmouseup="activateXray()">' +
      '<img src="./images/xray-icon.svg"/>' +
    '</button>' + 
    '<div class="xray-bottom-row">' +
      '<div class="slidecontainer">'+
        `<p id="diameter-text">Diameter: ${xrayDiameter}px</p>` +
        `<input type="range" min="1" max="1000" value="${xrayDiameter}" class="slider" id="diameter-slider">`+
      '</div>' + 
      '<button title="Remove the X-Ray spot" id="xray-close-button" class="nav-button" onClick="clearXray()">' + 
        '<img class="nav-icon" src="./images/xray-close-icon.svg"/>' +
      '</button>' +
    '</div>');

  let slider = document.getElementById("diameter-slider");
  let output = document.getElementById("diameter-text");
  
  // Update the current slider value
  slider.oninput = function() {
    output.innerHTML = "Diameter: " + this.value + "px";
    xrayDiameter = this.value;
  }

  /* Update the actual diameter only on release */
  slider.onmouseup = function() {
    csInterface.evalScript(`updateDiameter(${xrayDiameter})`);
  }

  activeFeature = XRAY;
}

/**
 * Starts up the crosshairs
 */
function activateCrosshairs() {
  csInterface.evalScript('startCrosshairs()');
  xrayIsUpdating = true;
}

/**
 * Crosshairs are done, actually triggers the X-Ray circle to be created
 */
function activateXray() {
  xrayIsUpdating = false;
  csInterface.evalScript('activateXray()');
}

/**
 * Paces out the crosshairs update speed
 */
function timer() {
  timerFinished = true;
}

/**
 * Updates the X-Ray plugin with the new gaze point data
 */
function updateXray(x, y) {

  // slow down the calls to host, only do when button held down
  if (timerFinished && xrayIsUpdating) {
    csInterface.evalScript(`updateCrosshairs("${x}", "${y}")`);
    timerFinished = false;
    setTimeout(timer, 300); //TODO: speed up to 100
  }
}

/**
 * Removes all mask layers that make up the X-Ray circle
 */
function clearXray() {
  csInterface.evalScript(`clearXray()`);
}


/***************************************************************************************
 *
 *                                  Privacy Shield
 *
 **************************************************************************************/

let isScreenActive = false;
let isShieldActive = false;

 /**
  * Creates the privacy shield front end in the plugin
  */
function startPrivacyShield() {
  $('#output').html('<img src="./images/privacy-shield-icon.svg" id="icon"/>');
  activeFeature = PRIVACY_SHIELD;
}

/**
 * Updates the privacy shield with the new gaze data
 * @param {*} isLooking whether the user is slightly looking off the screen, but may still be present
 * @param {*} isUserPresent whether the user is present at the computer
 */
function updatePrivacyShield(isLooking, isUserPresent) {

  // activate complete shield if user isn't present
  if (!isUserPresent && !isShieldActive) {
    console.log("Activating privacy shield!");
    csInterface.evalScript(`activatePrivacyShield()`);
    isShieldActive = true;
    return;
  }

  // activate partial screen if user just isn't looking
  if (!isLooking && !isScreenActive) {
    console.log("Activating privacy screen!");
    csInterface.evalScript(`activatePrivacyScreen()`);
    isScreenActive = true;
    return;
  }

  // go back to normal
  if ((isLooking && isScreenActive) ||
      (isLooking && isShieldActive)) {
    console.log("Turning off privacy...");
    csInterface.evalScript('deactivatePrivacy()');
    isScreenActive = false;
    isShieldActive = false;
  }
}


/***************************************************************************************
 *
 *                                  Navigation Buttons
 *
 **************************************************************************************/
 
var lockButton = document.getElementById("lock-button");
lockButton.addEventListener("click", toggleLock);

/**
 * Toggles the lock button when clicked. No gaze data effects the plugin while locked
 */
function toggleLock() {

  let lockedIcon = document.getElementById("locked-icon");
  let unlockedIcon = document.getElementById("unlocked-icon");
  
  if (isLocked) {
    //unlock!
    $("body").css('background-color', '#434343');
    unlockedIcon.style.display = "none";
    lockedIcon.style.display = "block";
    isLocked = false;
  }

  else {
    //lock!
    $("body").css('background-color', '#292929');
    lockedIcon.style.display = "none";
    unlockedIcon.style.display = "block";
    isLocked = true;
  }
}

var settingsButton = document.getElementById("settings-button");
settingsButton.addEventListener("click", openSettings);

/**
 * Open the settings window
 */
function openSettings() {

  closeTrigger(); // Make sure trigger's closed. so settings in the right spot
  csInterface.evalScript(`openSettings()`);
}


/***************************************************************************************
 *
 *                                  Helper Functions
 *
 **************************************************************************************/

 /**
  * Gets the active feature from the host settings panel, and updates locally if the active feature changed
  */
function updateActiveFeature() {
  csInterface.evalScript("getActiveFeature()", 
    function(newActiveFeature) { 

      if (Number(newActiveFeature) !== activeFeature) {

        //active feature updated!
        activeFeature = Number(newActiveFeature);
        switch (activeFeature) {
          case QUICK_TOOL:
            startQuickTool();  
            break;
          case XRAY:
            startXray();
            break;
          case PRIVACY_SHIELD:
            startPrivacyShield();
            break;
        }
      }
    }
  );
}

/**
 * Updates the port number from the host settings panel
 */
function updatePort() {
  csInterface.evalScript("getPort()", 
    function(newPort) { 

      if (Number(newPort) !== port) {

        //port updated!
        port = Number(newPort);
        ws.close();
        init();
      }
    }
  );
}

 /**
  * Writes an error message to screen
  */
 function writeToScreen(message) {
  document.getElementById("error-bar").style.display = "block";
  document.getElementById("message").innerHTML = message;
}

/**
 * Removes the error banner
 */
function clearWriting() {
  document.getElementById("message").innerHTML = "";
  document.getElementById("error-bar").style.display = "none";
}

/**
 * Shows the reconnect button
 */
function showReconnectButton() {
  let button = document.getElementById("reconnect");
  button.style.display = "block";
  button.onclick = init;

  let errorBar = document.getElementById("error-bar");
  errorBar.style.display = "block";
  errorBar.className = "error-bar--expanded";
}

/**
 * Hides the reconnect button
 */
function hideReconnectButton() {
  var button = document.getElementById("reconnect");
  button.style.display = "none";

  let errorBar = document.getElementById("error-bar");
  errorBar.className = "error-bar--normal";
}