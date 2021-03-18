'use strict';

const axios = require('axios').default;
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const parseStringPromise = require('xml2js').parseStringPromise;

const PLUGIN_NAME = 'homebridge-denon-tv';
const PLATFORM_NAME = 'DenonTv';
const ZONE_NAME = ['Main Zone', 'Zone 2', 'Zone 3'];
const SHORT_ZONE_NAME = ['MZ', 'Z2', 'Z3'];
const ZONE_NUMBER = ['MainZone_MainZone', 'Zone2_Zone2', 'Zone3_Zone3'];

let Accessory, Characteristic, Service, Categories, UUID;

module.exports = (api) => {
	Accessory = api.platformAccessory;
	Characteristic = api.hap.Characteristic;
	Service = api.hap.Service;
	Categories = api.hap.Categories;
	UUID = api.hap.uuid;
	api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, denonTvPlatform, true);
};

class denonTvPlatform {
	constructor(log, config, api) {
		// only load if configured
		if (!config || !Array.isArray(config.devices)) {
			log('No configuration found for %s', PLUGIN_NAME);
			return;
		}
		this.log = log;
		this.config = config;
		this.api = api;
		this.devices = config.devices || [];

		this.api.on('didFinishLaunching', () => {
			this.log.debug('didFinishLaunching');
			for (let i = 0; i < this.devices.length; i++) {
				const deviceName = this.devices[i];
				if (!deviceName.name) {
					this.log.warn('Device Name Missing')
				} else {
					new denonTvDevice(this.log, deviceName, this.api);
				}
			}
		});
	}

	configureAccessory(platformAccessory) {
		this.log.debug('configurePlatformAccessory');
	}

	removeAccessory(platformAccessory) {
		this.log.debug('removePlatformAccessory');
		this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [platformAccessory]);
	}
}

class denonTvDevice {
	constructor(log, config, api) {
		this.log = log;
		this.api = api;
		this.config = config;

		//device configuration
		this.name = config.name;
		this.host = config.host;
		this.port = config.port;
		this.refreshInterval = config.refreshInterval || 5;
		this.zoneControl = config.zoneControl || 0;
		this.masterPower = config.masterPower || false;
		this.masterVolume = config.masterVolume || false;
		this.masterMute = config.masterMute || false;
		this.volumeControl = config.volumeControl || 0;
		this.switchInfoMenu = config.switchInfoMenu;
		this.disableLogInfo = config.disableLogInfo;
		this.inputs = config.inputs || [];
		this.buttonsMainZone = config.buttonsMainZone || [];
		this.buttonsZone2 = config.buttonsZone2 || [];
		this.buttonsZone3 = config.buttonsZone3 || [];

		//get Device info
		this.manufacturer = config.manufacturer || 'Denon/Marantz';
		this.modelName = config.modelName || 'Model Name';
		this.serialNumber = config.serialNumber || 'Serial Number';
		this.firmwareRevision = config.firmwareRevision || 'Firmware Revision';
		this.zones = 1;
		this.apiVersion = null;

		//zones
		this.zoneName = ZONE_NAME[this.zoneControl];
		this.shortZoneName = SHORT_ZONE_NAME[this.zoneControl];
		this.zoneNumber = ZONE_NUMBER[this.zoneControl];

		//setup variables
		this.checkDeviceInfo = true;
		this.checkDeviceState = false;
		this.startPrepareAccessory = true;
		this.currentPowerState = false;
		this.currentMuteState = false;
		this.currentVolume = 0;
		this.currentInputName = '';
		this.currentInputReference = '';
		this.currentInputIdentifier = 0;
		this.currentPlayPause = false;
		this.inputsLength = this.inputs.length;
		this.buttonsLength = [this.buttonsMainZone.length, this.buttonsZone2.length, this.buttonsZone3.length][this.zoneControl];
		this.prefDir = path.join(api.user.storagePath(), 'denonTv');
		this.inputsFile = this.prefDir + '/' + 'inputs_' + this.host.split('.').join('');
		this.customInputsFile = this.prefDir + '/' + 'customInputs_' + this.host.split('.').join('');
		this.targetVisibilityInputsFile = this.prefDir + '/' + 'targetVisibilityInputs_' + this.host.split('.').join('');
		this.devInfoFile = this.prefDir + '/' + 'devInfo_' + this.host.split('.').join('');
		this.url = ('http://' + this.host + ':' + this.port);

		//check if prefs directory ends with a /, if not then add it
		if (this.prefDir.endsWith('/') === false) {
			this.prefDir = this.prefDir + '/';
		}
		//check if the directory exists, if not then create it
		if (fs.existsSync(this.prefDir) === false) {
			fsPromises.mkdir(this.prefDir);
		}
		//check if the files exists, if not then create it
		if (fs.existsSync(this.inputsFile) === false) {
			fsPromises.writeFile(this.inputsFile, '{}');
		}
		//check if the files exists, if not then create it
		if (fs.existsSync(this.customInputsFile) === false) {
			fsPromises.writeFile(this.customInputsFile, '{}');
		}
		//check if the files exists, if not then create it
		if (fs.existsSync(this.targetVisibilityInputsFile) === false) {
			fsPromises.writeFile(this.targetVisibilityInputsFile, '{}');
		}
		//check if the files exists, if not then create it
		if (fs.existsSync(this.devInfoFile) === false) {
			fsPromises.writeFile(this.devInfoFile, '{}');
		}

		//Check device state
		setInterval(function () {
			if (this.checkDeviceInfo) {
				this.getDeviceInfo();
			} else if (!this.checkDeviceInfo && this.checkDeviceState) {
				this.updateDeviceState();
			}
		}.bind(this), this.refreshInterval * 1000);
	}

	async getDeviceInfo() {
		this.log.debug('Device: %s %s, requesting Device Info.', this.host, this.name);
		try {
			const response = await axios.get(this.url + '/goform/Deviceinfo.xml');
			this.log.debug('Device: %s %s, debug response: %s', this.host, this.name, response.data);
			try {
				const result = await parseStringPromise(response.data);
				const devInfo = JSON.stringify(result.Device_Info, null, 2);
				const writeDevInfoFile = await fsPromises.writeFile(this.devInfoFile, devInfo);
				this.log.debug('Device: %s %s, saved Device Info successful.', this.host, this.name, devInfo);

				const manufacturer = ['Denon', 'Marantz'][result.Device_Info.BrandCode[0]] || this.manufacturer;
				const modelName = result.Device_Info.ModelName[0] || this.modelName;
				const serialNumber = result.Device_Info.MacAddress[0] || this.serialNumber;
				const firmwareRevision = result.Device_Info.UpgradeVersion[0] || this.firmwareRevision;
				const zones = result.Device_Info.DeviceZones[0] || 'Undefined';
				const apiVersion = result.Device_Info.CommApiVers[0] || 'Undefined';

				if (!this.disableLogInfo) {
					this.log('Device: %s %s %s, state: Online.', this.host, this.name, this.zoneName);
				}

				this.log('-------- %s --------', this.name);
				this.log('Manufacturer: %s', manufacturer);
				this.log('Model: %s', modelName);
				if (this.zoneControl >= 0) {
					this.log('Zones: %s', zones);
					this.log('Firmware: %s', firmwareRevision);
					this.log('Api version: %s', apiVersion);
					this.log('Serialnr: %s', serialNumber);
				}
				if (this.zoneControl === 1) {
					this.log('Zone: 2');
				}
				if (this.zoneControl === 2) {
					this.log('Zone: 3');
				}
				this.log('----------------------------------');
			} catch (error) {
				this.log.error('Device: %s %s, parse string error: %s', this.host, this.name, error);
				this.checkDeviceInfo = true;
			};
			this.checkDeviceInfo = false;
			this.updateDeviceState();
		} catch (error) {
			this.log.error('Device: %s %s, Device Info error: %s, state: Offline, trying to reconnect', this.host, this.name, error);
			this.checkDeviceInfo = true;
		};
	}

	async updateDeviceState() {
		this.log.debug('Device: %s %s, requesting Device state.', this.host, this.name);
		try {
			const response = await axios.get(this.url + '/goform/form' + this.zoneNumber + 'XmlStatusLite.xml');
			const result = await parseStringPromise(response.data);
			this.log.debug('Device: %s %s, debug response: %s, result: %s', this.host, this.name, response.data, result);
			const powerState = (result.item.Power[0].value[0] === 'ON');
			if (this.televisionService && (powerState !== this.currentPowerState)) {
				this.televisionService
					.updateCharacteristic(Characteristic.Active, powerState ? 1 : 0);
			}
			this.currentPowerState = powerState;

			const inputReference = result.item.InputFuncSelect[0].value[0];
			const inputIdentifier = (this.inputs.indexOf(inputReference) >= 0) ? this.inputs.indexOf(inputReference) : 0;
			const inputName = this.inputs[inputIdentifier].name;
			if (this.televisionService) {
				this.televisionService
					.updateCharacteristic(Characteristic.ActiveIdentifier, inputIdentifier);
			}
			this.currentInputReference = inputReference;
			this.currentInputIdentifier = inputIdentifier;
			this.currentInputName = inputName;

			const volume = (parseFloat(result.item.MasterVolume[0].value[0]) >= -79.5) ? parseInt(result.item.MasterVolume[0].value[0]) + 80 : 0;
			const mute = powerState ? (result.item.Mute[0].value[0] === 'on') : true;
			if (this.speakerService) {
				this.speakerService
					.updateCharacteristic(Characteristic.Volume, volume)
					.updateCharacteristic(Characteristic.Mute, mute);
				if (this.volumeService && this.volumeControl === 1) {
					this.volumeService
						.updateCharacteristic(Characteristic.Brightness, volume)
						.updateCharacteristic(Characteristic.On, !mute);
				}
				if (this.volumeServiceFan && this.volumeControl === 2) {
					this.volumeServiceFan
						.updateCharacteristic(Characteristic.RotationSpeed, volume)
						.updateCharacteristic(Characteristic.On, !mute);
				}
			}
			this.currentMuteState = mute;
			this.currentVolume = volume;
			this.checkDeviceState = true;

			//start prepare accessory
			if (this.startPrepareAccessory) {
				this.prepareAccessory();
			}
		} catch (error) {
			this.log.error('Device: %s %s %s, update Device state error: %s', this.host, this.name, this.zoneName, error);
			this.checkDeviceState = false;
			this.checkDeviceInfo = true;
		};
	}

	//Prepare accessory
	prepareAccessory() {
		this.log.debug('prepareAccessory');
		const accessoryName = this.name;
		const accessoryUUID = UUID.generate(accessoryName);
		const accessoryCategory = Categories.AUDIO_RECEIVER;
		const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

		//Prepare information service
		this.log.debug('prepareInformationService');
		let devInfo = { 'BrandCode': ['2'], 'ModelName': ['Model name'], 'MacAddress': ['Serial number'], 'UpgradeVersion': ['Firmware'] };
		try {
			devInfo = JSON.parse(fs.readFileSync(this.devInfoFile));
			this.log.debug('Device: %s %s, read devInfo: %s', this.host, accessoryName, devInfo)
		} catch (error) {
			this.log.error('Device: %s %s, read devInfo failed, error: %s', this.host, accessoryName, error)
		}

		const manufacturer = ['Denon', 'Marantz', 'Manufacturer'][devInfo.BrandCode[0]];
		const modelName = devInfo.ModelName[0];
		const serialNumber = devInfo.MacAddress[0];
		const firmwareRevision = devInfo.UpgradeVersion[0];

		accessory.removeService(accessory.getService(Service.AccessoryInformation));
		const informationService = new Service.AccessoryInformation();
		informationService
			.setCharacteristic(Characteristic.Name, accessoryName)
			.setCharacteristic(Characteristic.Manufacturer, manufacturer)
			.setCharacteristic(Characteristic.Model, modelName)
			.setCharacteristic(Characteristic.SerialNumber, serialNumber)
			.setCharacteristic(Characteristic.FirmwareRevision, firmwareRevision);
		accessory.addService(informationService);

		//Prepare television service
		this.log.debug('prepareTelevisionService');
		this.televisionService = new Service.Television(accessoryName, 'televisionService');
		this.televisionService.setCharacteristic(Characteristic.ConfiguredName, accessoryName);
		this.televisionService.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

		this.televisionService.getCharacteristic(Characteristic.Active)
			.onGet(async () => {
				const state = this.currentPowerState ? 1 : 0;
				if (!this.disableLogInfo) {
					this.log('Device: %s %s, get current Power state successfull, state: %s', this.host, accessoryName, state ? 'ON' : 'OFF');
				}
				return state;
			})
			.onSet(async (state) => {
				if (state != this.currentPowerState) {
					try {
						const zControl = this.masterPower ? 3 : this.zoneControl
						this.log.debug('zControl is %s', zControl)
						const newState = [(state ? 'ZMON' : 'ZMOFF'), (state ? 'Z2ON' : 'Z2OFF'), (state ? 'Z3ON' : 'Z3OFF'), (state ? 'PWON' : 'PWSTANDBY')][zControl];
						const response = await axios.get(this.url + '/goform/formiPhoneAppDirect.xml?' + newState);
						if (!this.disableLogInfo) {
							this.log('Device: %s %s %s, set new Power state successful: %s', this.host, accessoryName, this.zoneName, newState);
						}
					} catch (error) {
						this.log.error('Device: %s %s %s, can not set new Power state. Might be due to a wrong settings in config, error: %s', this.host, accessoryName, this.zoneName, error);
					};
				}
			});

		this.televisionService.getCharacteristic(Characteristic.ActiveIdentifier)
			.onGet(async () => {
				const inputReference = this.currentInputReference;
				const inputIdentifier = (this.inputs.indexOf(inputReference) >= 0) ? this.inputs.indexOf(inputReference) : 0;
				const inputName = this.inputs[inputIdentifier].name;
				if (!this.disableLogInfo) {
					this.log('Device: %s %s %s, get current Input successful: %s %s', this.host, accessoryName, this.zoneName, inputName, inputReference);
				}
				return inputIdentifier;
			})
			.onSet(async (inputIdentifier) => {
				try {
					const inputName = this.inputs[inputIdentifier].name;
					const inputReference = this.inputs[inputIdentifier].reference;
					const inputMode = this.inputs[inputIdentifier].mode;
					const zone = [inputMode, 'Z2', 'Z3'][this.zoneControl];
					const response = await axios.get(this.url + '/goform/formiPhoneAppDirect.xml?' + zone + inputReference);
					if (!this.disableLogInfo) {
						this.log('Device: %s %s %s, set new Input successful: %s %s', this.host, accessoryName, this.zoneName, inputName, inputReference);
					}
					this.currentInputReference = inputReference;
				} catch (error) {
					this.log.error('Device: %s %s %s, can not set new Input. Might be due to a wrong settings in config, error: %s', this.host, accessoryName, this.zoneName, error);
				};
			});

		this.televisionService.getCharacteristic(Characteristic.RemoteKey)
			.onSet(async (command) => {
				try {
					if (this.currentInputReference === 'SPOTIFY' || this.currentInputReference === 'BT' || this.currentInputReference === 'USB/IPOD' || this.currentInputReference === 'NET' || this.currentInputReference === 'MPLAY') {
						switch (command) {
							case Characteristic.RemoteKey.REWIND:
								command = 'NS9E';
								break;
							case Characteristic.RemoteKey.FAST_FORWARD:
								command = 'NS9D';
								break;
							case Characteristic.RemoteKey.NEXT_TRACK:
								command = 'MN9D';
								break;
							case Characteristic.RemoteKey.PREVIOUS_TRACK:
								command = 'MN9E';
								break;
							case Characteristic.RemoteKey.ARROW_UP:
								command = 'NS90';
								break;
							case Characteristic.RemoteKey.ARROW_DOWN:
								command = 'NS91';
								break;
							case Characteristic.RemoteKey.ARROW_LEFT:
								command = 'NS92';
								break;
							case Characteristic.RemoteKey.ARROW_RIGHT:
								command = 'NS93';
								break;
							case Characteristic.RemoteKey.SELECT:
								command = 'NS94';
								break;
							case Characteristic.RemoteKey.BACK:
								command = 'MNRTN';
								break;
							case Characteristic.RemoteKey.EXIT:
								command = 'MNRTN';
								break;
							case Characteristic.RemoteKey.PLAY_PAUSE:
								command = this.currentPlayPause ? 'NS9B' : 'NS9A';
								this.currentPlayPause = !this.currentPlayPause;
								break;
							case Characteristic.RemoteKey.INFORMATION:
								command = this.switchInfoMenu ? 'MNINF' : 'MNOPT';
								break;
						}
					} else {
						switch (command) {
							case Characteristic.RemoteKey.REWIND:
								command = 'MN9E';
								break;
							case Characteristic.RemoteKey.FAST_FORWARD:
								command = 'MN9D';
								break;
							case Characteristic.RemoteKey.NEXT_TRACK:
								command = 'MN9F';
								break;
							case Characteristic.RemoteKey.PREVIOUS_TRACK:
								command = 'MN9G';
								break;
							case Characteristic.RemoteKey.ARROW_UP:
								command = 'MNCUP';
								break;
							case Characteristic.RemoteKey.ARROW_DOWN:
								command = 'MNCDN';
								break;
							case Characteristic.RemoteKey.ARROW_LEFT:
								command = 'MNCLT';
								break;
							case Characteristic.RemoteKey.ARROW_RIGHT:
								command = 'MNCRT';
								break;
							case Characteristic.RemoteKey.SELECT:
								command = 'MNENT';
								break;
							case Characteristic.RemoteKey.BACK:
								command = 'MNRTN';
								break;
							case Characteristic.RemoteKey.EXIT:
								command = 'MNRTN';
								break;
							case Characteristic.RemoteKey.PLAY_PAUSE:
								command = 'NS94';
								break;
							case Characteristic.RemoteKey.INFORMATION:
								command = this.switchInfoMenu ? 'MNINF' : 'MNOPT';
								break;
						}
					}
					const response = await axios.get(this.url + '/goform/formiPhoneAppDirect.xml?' + command);
					if (!this.disableLogInfo) {
						this.log('Device: %s %s, setRemoteKey successful, command: %s', this.host, accessoryName, command);
					}
				} catch (error) {
					this.log.error('Device: %s %s, can not setRemoteKey command. Might be due to a wrong settings in config, error: %s', this.host, accessoryName, error);
				};
			});

		this.televisionService.getCharacteristic(Characteristic.PowerModeSelection)
			.onSet(async (command) => {
				try {
					switch (command) {
						case Characteristic.PowerModeSelection.SHOW:
							command = this.switchInfoMenu ? 'MNOPT' : 'MNINF';
							break;
						case Characteristic.PowerModeSelection.HIDE:
							command = 'MNRTN';
							break;
					}
					const response = await axios.get(this.url + '/goform/formiPhoneAppDirect.xml?' + command);
					if (!this.disableLogInfo) {
						this.log('Device: %s %s, setPowerModeSelection successful, command: %s', this.host, accessoryName, command);
					}
				} catch (error) {
					this.log.error('Device: %s %s %s, can not setPowerModeSelection command. Might be due to a wrong settings in config, error: %s', this.host, accessoryName, this.zoneName, error);
				};
			});
		this.televisionService.getCharacteristic(Characteristic.PictureMode)
			.onSet(async (command) => {
				try {
					switch (command) {
						case Characteristic.PictureMode.OTHER:
							command = 'PVMOV';
							break;
						case Characteristic.PictureMode.STANDARD:
							command = 'PVSTD';
							break;
						case Characteristic.PictureMode.CALIBRATED:
							command = 'PVDAY';
							break;
						case Characteristic.PictureMode.CALIBRATED_DARK:
							command = 'PVNGT';
							break;
						case Characteristic.PictureMode.VIVID:
							command = 'PVVVD';
							break;
						case Characteristic.PictureMode.GAME:
							command = 'PVSTM';
							break;
						case Characteristic.PictureMode.COMPUTER:
							command = 'PVSTM';
							break;
						case Characteristic.PictureMode.CUSTOM:
							command = 'PVCTM';
							break;
					}
					const response = await axios.get(this.url + '/goform/formiPhoneAppDirect.xml?' + command);
					if (!this.disableLogInfo) {
						this.log('Device: %s %s, setPictureMode successful, command: %s', this.host, accessoryName, command);
					}
				} catch (error) {
					this.log.error('Device: %s %s %s, can not setPictureMode command. Might be due to a wrong settings in config, error: %s', this.host, accessoryName, this.zoneName, error);
				};
			});

		accessory.addService(this.televisionService);

		//Prepare speaker service
		this.log.debug('prepareSpeakerService');
		this.speakerService = new Service.TelevisionSpeaker(accessoryName + ' Speaker', 'speakerService');
		this.speakerService
			.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
			.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
		this.speakerService.getCharacteristic(Characteristic.VolumeSelector)
			.onSet(async (command) => {
				try {
					const zControl = this.masterVolume ? 3 : this.zoneControl
					const zone = ['MV', 'Z2', 'Z3', 'MV'][zControl];
					switch (command) {
						case Characteristic.VolumeSelector.INCREMENT:
							command = 'UP';
							break;
						case Characteristic.VolumeSelector.DECREMENT:
							command = 'DOWN';
							break;
					}
					const response = await axios.get(this.url + '/goform/formiPhoneAppDirect.xml?' + zone + command);
					if (!this.disableLogInfo) {
						this.log('Device: %s %s %s, setVolumeSelector successful, command: %s', this.host, accessoryName, this.zoneName, command);
					}
				} catch (error) {
					this.log.error('Device: %s %s %s, can not setVolumeSelector command. Might be due to a wrong settings in config, error: %s', this.host, accessoryName, this.zoneName, error);
				};
			});
		this.speakerService.getCharacteristic(Characteristic.Volume)
			.onGet(async () => {
				const volume = this.currentVolume;
				if (!this.disableLogInfo) {
					this.log('Device: %s %s %s, get current Volume level successful: %s dB', this.host, accessoryName, this.zoneName, (volume - 80));
				}
				return volume;
			})
			.onSet(async (volume) => {
				try {
					const zControl = this.masterVolume ? 3 : this.zoneControl
					const zone = ['MV', 'Z2', 'Z3', 'MV'][zControl];
					if (volume === 0 || volume === 100) {
						if (this.currentVolume < 10) {
							volume = '0' + this.currentVolume;
						} else {
							volume = this.currentVolume;
						}
					} else {
						if (volume < 10) {
							volume = '0' + volume;
						}
					}
					const response = await axios.get(this.url + '/goform/formiPhoneAppDirect.xml?' + zone + volume);
					if (!this.disableLogInfo) {
						this.log('Device: %s %s %s, set new Volume level successful: %s dB', this.host, accessoryName, this.zoneName, volume - 80);
					}
				} catch (error) {
					this.log.error('Device: %s %s %s, can not set new Volume level. Might be due to a wrong settings in config, error: %s', this.host, accessoryName, this.zoneName, error);
				};
			});
		this.speakerService.getCharacteristic(Characteristic.Mute)
			.onGet(async () => {
				const state = this.currentMuteState;
				if (!this.disableLogInfo) {
					this.log('Device: %s %s %s, get current Mute state successful: %s', this.host, accessoryName, this.zoneName, state ? 'ON' : 'OFF');
				}
				return state;
			})
			.onSet(async (state) => {
				if (state !== this.currentMuteState) {
					try {
						const zControl = this.masterMute ? 3 : this.zoneControl
						const newState = [(state ? 'MUON' : 'MUOFF'), (state ? 'Z2MUON' : 'Z2MUOFF'), (state ? 'Z3MUON' : 'Z3MUOFF'), (state ? 'MUON' : 'MUOFF')][zControl];
						const response = await axios.get(this.url + '/goform/formiPhoneAppDirect.xml?' + newState);
						if (!this.disableLogInfo) {
							this.log('Device: %s %s %s, set new Mute state successful: %s', this.host, accessoryName, this.zoneName, state ? 'ON' : 'OFF');
						}
					} catch (error) {
						this.log.error('Device: %s %s %s, can not set new Mute state. Might be due to a wrong settings in config, error: %s', this.host, accessoryName, this.zoneName, error);
					};
				}
			});

		accessory.addService(this.speakerService);
		this.televisionService.addLinkedService(this.speakerService);

		//Prepare volume service
		if (this.volumeControl >= 1) {
			this.log.debug('prepareVolumeService');
			if (this.volumeControl === 1) {
				this.volumeService = new Service.Lightbulb(accessoryName + ' Volume', 'volumeService');
				this.volumeService.getCharacteristic(Characteristic.Brightness)
					.onGet(async () => {
						const volume = this.currentVolume;
						return volume;
					})
					.onSet(async (volume) => {
						this.speakerService.setCharacteristic(Characteristic.Volume, volume);
					});
				this.volumeService.getCharacteristic(Characteristic.On)
					.onGet(async () => {
						const state = !this.currentMuteState;
						return state;
					})
					.onSet(async (state) => {
						this.speakerService.setCharacteristic(Characteristic.Mute, !state);
					});
				accessory.addService(this.volumeService);
				this.volumeService.addLinkedService(this.volumeService);
			}
			if (this.volumeControl === 2) {
				this.volumeServiceFan = new Service.Fan(accessoryName + ' Volume', 'volumeServiceFan');
				this.volumeServiceFan.getCharacteristic(Characteristic.RotationSpeed)
					.onGet(async () => {
						const volume = this.currentVolume;
						return volume;
					})
					.onSet(async (volume) => {
						this.speakerService.setCharacteristic(Characteristic.Volume, volume);
					});
				this.volumeServiceFan.getCharacteristic(Characteristic.On)
					.onGet(async () => {
						const state = !this.currentMuteState;
						return state;
					})
					.onSet(async (state) => {
						this.speakerService.setCharacteristic(Characteristic.Mute, !state);
					});
				accessory.addService(this.volumeServiceFan);
				this.televisionService.addLinkedService(this.volumeServiceFan);
			}
		}

		//Prepare inputs services
		if (this.inputsLength > 0) {
			this.log.debug('prepareInputsService');
			this.inputsService = new Array();
			this.inputsReference = new Array();
			this.inputsName = new Array();
			this.inputsType = new Array();
			this.inputsMode = new Array();
			const inputs = this.inputs;

			const savedNames = (fs.readFileSync(this.customInputsFile) !== undefined) ? JSON.parse(fs.readFileSync(this.customInputsFile)) : {};
			this.log.debug('Device: %s %s, read savedNames: %s', this.host, accessoryName, savedNames);

			const savedTargetVisibility = (fs.readFileSync(this.targetVisibilityInputsFile) !== undefined) ? JSON.parse(fs.readFileSync(this.targetVisibilityInputsFile)) : {};
			this.log.debug('Device: %s %s, read savedTargetVisibility: %s', this.host, accessoryName, savedTargetVisibility);

			//check possible inputs count
			let inputsLength = this.inputsLength;
			if (inputsLength > 96) {
				inputsLength = 96;
				this.log('Inputs count reduced to: %s, because excedded maximum of services', inputsLength)
			}
			for (let i = 0; i < inputsLength; i++) {

				//get input reference
				const inputReference = inputs[i].reference;

				//get input name		
				const inputName = (savedNames[inputReference] !== undefined) ? savedNames[inputReference] : (inputs[i].name !== undefined) ? inputs[i].name : inputs[i].reference;

				//get input type
				const inputType = 5;

				//get input mode
				const inputMode = inputs[i].mode;

				//get input configured
				const isConfigured = 1;

				//get input visibility state
				const targetVisibility = (savedTargetVisibility[inputReference] !== undefined) ? savedTargetVisibility[inputReference] : 0;
				const currentVisibility = targetVisibility;

				const inputService = new Service.InputSource(inputReference, 'input' + i);
				inputService
					.setCharacteristic(Characteristic.Identifier, i)
					.setCharacteristic(Characteristic.ConfiguredName, inputName)
					.setCharacteristic(Characteristic.IsConfigured, isConfigured)
					.setCharacteristic(Characteristic.InputSourceType, inputType)
					.setCharacteristic(Characteristic.CurrentVisibilityState, currentVisibility)
					.setCharacteristic(Characteristic.TargetVisibilityState, targetVisibility);

				inputService
					.getCharacteristic(Characteristic.ConfiguredName)
					.onSet(async (name) => {
						try {
							let newName = savedNames;
							newName[inputReference] = name;
							await fsPromises.writeFile(this.customInputsFile, JSON.stringify(newName, null, 2));
							this.log.debug('Device: %s %s, saved new Input successful, savedNames: %s', this.host, accessoryName, JSON.stringify(newName, null, 2));
							if (!this.disableLogInfo) {
								this.log('Device: %s %s, new Input name saved successful, name: %s reference: %s', this.host, accessoryName, name, inputReference);
							}
						} catch (error) {
							this.log.error('Device: %s %s, new Input name saved failed, error: %s', this.host, accessoryName, error);
						}
					});

				inputService
					.getCharacteristic(Characteristic.TargetVisibilityState)
					.onGet(async () => {
						const state = targetVisibility;
						if (!this.disableLogInfo) {
							this.log('Device: %s %s, Input: %s, get target visibility state: %s', this.host, accessoryName, inputName, state ? 'HIDEN' : 'SHOWN');
						}
						return state;
					})
					.onSet(async (state) => {
						try {
							let newState = savedTargetVisibility;
							newState[inputReference] = state;
							await fsPromises.writeFile(this.targetVisibilityInputsFile, JSON.stringify(newState, null, 2));
							this.log.debug('Device: %s %s, Input: %s, saved target visibility state: %s', this.host, accessoryName, inputName, JSON.stringify(newState, null, 2));
							if (!this.disableLogInfo) {
								this.log('Device: %s %s, Input: %s, saved target visibility state: %s', this.host, accessoryName, inputName, state ? 'HIDEN' : 'SHOWN');
							}
							inputService.setCharacteristic(Characteristic.CurrentVisibilityState, state);
						} catch (error) {
							this.log.error('Device: %s %s, Input: %s, saved target visibility state error: %s', this.host, accessoryName, error);
						}
					});

				this.inputsReference.push(inputReference);
				this.inputsName.push(inputName);
				this.inputsType.push(inputType);
				this.inputsMode.push(inputMode);

				this.inputsService.push(inputService);
				accessory.addService(this.inputsService[i]);
				this.televisionService.addLinkedService(this.inputsService[i]);
			}
		};

		//Prepare inputs button services
		if (this.buttonsLength > 0) {
			this.log.debug('prepareInputsButtonService');
			this.buttonsService = new Array();
			this.buttonsReference = new Array();
			this.buttonsName = new Array();
			const buttons = [this.buttonsMainZone, this.buttonsZone2, this.buttonsZone3][this.zoneControl];

			//check possible buttons count
			let buttonsLength = this.buttonsLength;
			if ((this.inputsLength + buttonsLength) > 96) {
				buttonsLength = 96 - this.inputsLength;
				this.log('Buttons count reduced to: %s, because excedded maximum of services', buttonsLength)
			}
			for (let i = 0; i < buttonsLength; i++) {
				const buttonReference = buttons[i].reference;
				const buttonName = (buttons[i].name !== undefined) ? buttons[i].name : buttons[i].reference;
				const buttonService = new Service.Switch(this.shortZoneName + ' ' + buttonName, 'buttonService' + i);
				buttonService.getCharacteristic(Characteristic.On)
					.onGet(async () => {
						const state = false;
						if (!this.disableLogInfo) {
							this.log('Device: %s %s %s, get current state successful: %s', this.host, accessoryName, this.zoneName, state);
						}
						return state;
					})
					.onSet(async (state) => {
						if (state && this.currentPowerState) {
							try {
								const response = await axios.get(this.url + '/goform/formiPhoneAppDirect.xml?' + buttonReference);
								if (!this.disableLogInfo) {
									this.log('Device: %s %s %s, set new Input successful: %s %s', this.host, accessoryName, this.zoneName, buttonName, buttonReference);
								}
								setTimeout(() => {
									buttonService
										.getCharacteristic(Characteristic.On).updateValue(false);
								}, 50);
							} catch (error) {
								this.log.error('Device: %s %s %s, can not set new Input. Might be due to a wrong settings in config, error: %s', this.host, accessoryName, this.zoneName, error);
								setTimeout(() => {
									buttonService
										.getCharacteristic(Characteristic.On).updateValue(false);
								}, 50);
							};
						} else {
							setTimeout(() => {
								buttonService
									.getCharacteristic(Characteristic.On).updateValue(false);
							}, 50);
						}
					});
				this.buttonsReference.push(buttonReference);
				this.buttonsName.push(buttonName);

				this.buttonsService.push(buttonService)
				accessory.addService(this.buttonsService[i]);
				this.televisionService.addLinkedService(this.buttonsService[i]);
			}
		}
		this.startPrepareAccessory = false;
		this.log.debug('Device: %s %s, publishExternalAccessories.', this.host, accessoryName);
		this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
	}
};