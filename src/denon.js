'use strict';
const axios = require('axios');
const parseString = require('xml2js').parseStringPromise;
const EventEmitter = require('events');
const CONSTANS = require('./constans.json');

const SOUND_MODE_STATUS = `<?xml version="1.0" encoding="utf-8"?>
            <tx>
              <cmd id="1">${CONSTANS.BodyXml.GetSurroundModeStatus}</cmd>
            </tx>`;
const CONFIG_XML = {
    data: SOUND_MODE_STATUS,
    headers: {
        'Content-Type': 'text/xml'
    }
};

class DENON extends EventEmitter {
    constructor(config) {
        super();
        const host = config.host;
        const port = config.port;
        const debugLog = config.debugLog;
        const zoneControl = config.zoneControl;
        const mqttEnabled = config.mqttEnabled;
        this.refreshInterval = config.refreshInterval;

        const baseUrl = (`http://${host}:${port}`);
        this.axiosInstance = axios.create({
            method: 'GET',
            timeout: 10000,
            baseURL: baseUrl
        });

        this.axiosInstancePost = axios.create({
            method: 'POST',
            timeout: 10000,
            baseURL: baseUrl
        });

        this.checkStateOnFirstRun = false;
        this.power = false;
        this.reference = '';
        this.volume = 0;
        this.mute = true;
        this.soundMode = '';
        this.devInfo = '';

        this.on('checkDeviceInfo', async () => {
            try {
                const deviceInfo = await this.axiosInstance(CONSTANS.ApiUrls.DeviceInfo);
                const parseDeviceInfo = await parseString(deviceInfo.data);
                const devInfo = parseDeviceInfo.Device_Info;
                const devInfo1 = JSON.stringify(devInfo, null, 2);
                const debug = debugLog ? this.emit('debug', `Info: ${JSON.stringify(devInfo, null, 2)}`) : false;

                const manufacturer = ['Denon', 'Marantz'][devInfo.BrandCode[0]] || 'Marantz';
                const modelName = devInfo.ModelName[0] || 'undefined';
                const serialNumber = devInfo.MacAddress[0] || 'undefined';
                const firmwareRevision = devInfo.UpgradeVersion[0] || 'undefined';
                const zones = devInfo.DeviceZones[0] || 'undefined';
                const apiVersion = devInfo.CommApiVers[0] || 'undefined';
                this.devInfo = devInfo;

                if (serialNumber === null || serialNumber === undefined) {
                    const debug1 = debugLog ? this.emit('debug', `Serial number unknown: ${serialNumber}, reconnect in 15s.`) : false;
                    this.checkDeviceInfo();
                    return;
                }

                this.checkStateOnFirstRun = true;
                this.emit('connected', devInfo, devInfo1);
                this.emit('deviceInfo', manufacturer, modelName, serialNumber, firmwareRevision, zones, apiVersion);
                this.emit('checkState');
            } catch (error) {
                this.emit('error', `Info error: ${error}, reconnect in 15s.`)
                this.checkDeviceInfo();
            };
        })
            .on('checkState', async () => {
                try {
                    const zoneUrl = [CONSTANS.ApiUrls.MainZoneStatusLite, CONSTANS.ApiUrls.Zone2StatusLite, CONSTANS.ApiUrls.Zone3StatusLite, CONSTANS.ApiUrls.SoundModeStatus][zoneControl];
                    const deviceState = await this.axiosInstance(zoneUrl);
                    const parseDeviceState = await parseString(deviceState.data);
                    const devState = parseDeviceState.item;
                    const debug = debugLog ? this.emit('debug', `State: ${JSON.stringify(devState, null, 2)}`) : false;

                    const checkSoundMode = (zoneControl === 0 || zoneControl === 3)
                    const deviceSoundMode = checkSoundMode ? await this.axiosInstancePost(CONSTANS.ApiUrls.AppCommand, CONFIG_XML) : false;
                    const parseDeviceSoundMode = checkSoundMode ? await parseString(deviceSoundMode.data) : false;
                    const debug1 = this.debugLog ? this.emit('debug', `Sound mode: ${JSON.stringify(parseDeviceSoundMode, null, 2)}`) : false;
                    const soundMode = checkSoundMode ? CONSTANS.SoundMode[(parseDeviceSoundMode.rx.cmd[0].surround[0]).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()] : this.soundMode;

                    const power = (devState.Power[0].value[0] === 'ON');
                    const reference = (zoneControl === 3) ? soundMode : (devState.InputFuncSelect[0].value[0] === 'Internet Radio') ? 'IRADIO' : (devState.InputFuncSelect[0].value[0] === 'AirPlay') ? 'NET' : devState.InputFuncSelect[0].value[0];
                    const volume = (parseFloat(devState.MasterVolume[0].value[0]) >= -79.5) ? parseInt(devState.MasterVolume[0].value[0]) + 80 : this.volume;
                    const mute = power ? (devState.Mute[0].value[0] == 'on') : true;

                    if (!this.checkStateOnFirstRun && power === this.power && reference === this.reference && volume === this.volume && mute === this.mute && soundMode === this.soundMode) {
                        this.checkState();
                        return;
                    };

                    this.power = power;
                    this.reference = reference;
                    this.volume = volume;
                    this.mute = mute;
                    this.soundMode = soundMode;
                    this.checkStateOnFirstRun = false;
                    this.emit('stateChanged', power, reference, volume, mute, soundMode);
                    const mqtt = mqttEnabled ? this.emit('mqtt', 'Info', JSON.stringify(this.devInfo, null, 2)) : false;
                    const mqtt1 = mqttEnabled ? this.emit('mqtt', 'State', JSON.stringify(devState, null, 2)) : false;
                    const surroundMode = {
                        'surround': soundMode
                    }
                    const emitMgtt = checkSoundMode ? this.emit('mqtt', 'Sound Mode', JSON.stringify(surroundMode, null, 2)) : false;
                    this.checkState();
                } catch (error) {
                    this.emit('error', `State error: ${error}, reconnect in 15s.`);
                    const firstRun = this.checkStateOnFirstRun ? this.checkDeviceInfo() : this.emit('disconnect');
                };
            })
            .on('disconnect', () => {
                this.emit('disconnected', 'Disconnected.');
                this.emit('stateChanged', false, this.reference, this.volume, true, this.soundMode);
                this.checkDeviceInfo();
            });

        this.emit('checkDeviceInfo');
    };

    async checkDeviceInfo() {
        await new Promise(resolve => setTimeout(resolve, 15000));
        this.emit('checkDeviceInfo');
    };

    async checkState() {
        await new Promise(resolve => setTimeout(resolve, this.refreshInterval * 1000));
        this.emit('checkState');
    };

    send(apiUrl) {
        return new Promise(async (resolve, reject) => {
            try {
                const sendCommand = await this.axiosInstance(apiUrl);
                resolve(true);
            } catch (error) {
                this.emit('error', `Send command error: ${error}`);
                reject(error);
            };
        });
    };
};
module.exports = DENON;