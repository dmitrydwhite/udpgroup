const dgram = require('dgram');
const EventEmitter = require('events');
const { PassThrough } = require('stream');

const STANDARD_LOCAL = '127.0.0.1';
const localhosts = [STANDARD_LOCAL, '0.0.0.0', 'localhost'];

const DGRAM_EVENTS = ['close', 'connect', 'error', 'listening'];
const DGRAM_PASSTHROUGH_METHODS = [
  'address',
  'close',
  'getRecvBufferSize',
  'setRecvBufferSize',
  'getSendBufferSize',
  'setSendBufferSize',
  'ref',
  'unref',
];

class UdpGroup extends EventEmitter {
  constructor(config, ...initialPathways) {
    const { listen_port, udp_version = 'udp4' } = config;

    super();

    this.pathways = {};
    this.nicknames = {};
    this.socket = dgram.createSocket(udp_version);
    this.socket.bind(listen_port);
    this.socket.on('message', (message, rinfo) => {
      this.handleMessage(message, rinfo);
      this.emit('message', message, rinfo);
    });

    DGRAM_EVENTS.forEach(event => {
      this.socket.on(event, (...args) => {
        this.emit(event, ...args);
      });
    });

    DGRAM_PASSTHROUGH_METHODS.forEach(methodName => {
      this[methodName] = this.socket[methodName];
    });

    const pathwayBundles = [...initialPathways].map(this.createPathway);

    // Todo: how do we do pathways at the time of instantiation?
    this.emit('pathways', pathwayBundles);
  }

  handleMessage(data, rinfo) {
    const destinationStreams = this.determinePathway(rinfo);

    destinationStreams.forEach(pathway => {
      const copyOfData = Buffer.alloc(data.length);

      data.copy(copyOfData);
      pathway.write(copyOfData);
    });
  }

  /**
   * Normalize localhost addresses
   * @param {String} address The address value from the received rinfo object
   * @returns {String}
   */
  normalizeAddr(address) {
    if (localhosts.includes(address)) {
      return STANDARD_LOCAL;
    }

    return address;
  }

  /**
   * Determine which streams match the source of the received message.
   * @param {Object} rinfo The rinfo value from the received message
   * @returns {PassThrough[]}
   */
  determinePathway(rinfo) {
    const { address: raddress, port } = rinfo;
    const address = this.normalizeAddr(raddress);
    const addressOnlyPaths = this.pathways[address] || [];
    const addyPlusPortPaths = this.pathways[`${address}_${port}`] || [];

    return [...addressOnlyPaths, ...addyPlusPortPaths];
  }

  createPathway(config) {
    if (typeof config !== 'object' || !config.remote_address) {
      throw new Error('Pathway must be added using an object with remote_address property');
    }

    const {
      remote_address,
      remote_name,
      remote_port
    } = config;
    const remote_port_value = !remote_port || remote_port === '*' ? '' : remote_port;
    const remote_id = `${this.normalizeAddr(remote_address)}${remote_port_value ? `_${remote_port_value}` : ''}`;
    const pathwayStream = new PassThrough();
    const textDestination = `remote address ${remote_address}${remote_port_value ? ` and remote port ${remote_port_value}` : ''}`;

    if (remote_name) {
      this.nicknames[remote_name] = remote_id;
    }

    this.emit(
      'info',
      `Creating a pathway ${remote_name || remote_id} listening for messages from ${textDestination}`
    );

    if (!pathways[remote_id]) {
      this.pathways[remote_id] = [pathwayStream];
    } else {
      this.emit('warning', `There are multiple pathways listening for messages from ${textDestination}`);
      this.pathways[remote_id].push(pathwayStream);
    }

    return [pathwayStream, remote_name || remote_id];
  }

  addPathway(config, cb) {
    try {
      const pathwayVals = this.createPathway(config);
      cb(null, ...pathwayVals);
    } catch (err) {
      cb(err);
    }
  }

  getSendArgsFrom(pathwayId, offset, length, cb) {
    const sendArgs = [];
    const destinationString = this.pathways[pathwayId] || this.pathways[this.nicknames[pathwayId]];
    let callback;

    if (offset || length) {
      if (typeof offset === 'function') {
        callback = offset;
      } else {
        sendArgs.concat([offset, length]);
      }
    }

    if (destinationString) {
      const [address, strPort] = destinationString.split('_');
      const port = Number(strPort);

      if (!Number.isFinite(port)) {
        throw new Error('A port is required in order to send');
      }

      if (!callback) { callback = cb; }

      return [...sendArgs, port, address, callback];
    } else {
      throw new Error(`The pathway named ${pathwayId} has not been defined for this group`);
    }
  }

  _send(...args) {
    try {
      this.socket.send(...args);
    } catch (err) {
      if (err.code === 'ERR_SOCKET_BAD_PORT') {
        const [data, offset, length, pathwayName, callback] = [...args];
        let pathwayId;

        if (typeof offset === 'string' && Number.isNaN(Number(offset))) {
          pathwayId = offset;
        }

        if (Number.isFinite(Number(offset))) {
          pathwayId = pathwayName;
        }

        try {
          this.socket.send(data, ...this.getSendArgsFrom(pathwayId, offset, length, callback));
        } catch (err) {
          this.emit('error', err);
        }
      } else {
        throw err;
      }
    }
  }

  send(...args) {
    this._send(...args);
  }
}

module.exports = UdpGroup;
