'use strict';

const { app } = require('electron');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
app.getAppPath = () => projectRoot;

require('./offline-startup-network-hook.cjs');
require('../desktop/main.cjs');
