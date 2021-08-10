# `udpgroup`

### What is `udpgroup`?
`udpgroup` creates a simple API wrapper around the Node JS `dgram` module to organize multiple duplex functions on a single UDP port.

### Simple Implementation:

Let's imagine that we have a setup like this:
* On one machine, we're running `MainNodeJSApp` that needs to handle UDP packets to and from various sources, process them, and send them on to another service over HTTP.
* On a separate `Remote Device`, we have two dedicated processes that also will send and receive UDP packets:
  * The `Telemetry` process is assigned to port `8001`
  * The `Files` process is assigned to port `8005`
* `MainNodeJSApp` listens and sends to `Remote Device` on port `40004`.
* Internally, `MainNodeJSApp` is using NodeJS Streams to both handle files received and process telemetry data. Both of those data structures are completely different, so `MainNodeJSApp` has two different NodeJS streams to process them.

We can imagine our setup looks something like this:
<image
  src="https://drive.google.com/uc?id=18s-cfDLfnuG7VR53S_kKaq_PBUu2bIk3"
  alt="A system diagram with MainNodeJSApp connected over UDP to ports 8001 and 8005 on Remote Device; see github readme for image"
/>

We'll use `udpgroup` to coordinate the messages to and from the `Telemetry` and `Files` processes on `Remote Device`.

First, we'll require the library:
```js
const UdpGroup = require('udpgroup');
```

Then we'll instantiate a new UdpGroup with the port that we'll be listening on:
```js
const udpg = new UdpGroup({ listen_port: 40004 });
```

We'll make sure that the streams we want to divert to have been created, then we'll use the `.addPathway` method to add a named pathway for files and telemetry. The `.addPathway` method takes a config object and a callback function.
```js
const telemStream = createTelemetryStreamSomehow();
const filesStream = createFilesStreamSomehow();

udpg.addPathway(
  { remote_name: 'telemetryService', remote_ip: '192.175.12.24', remote_port: 8001 },
  (err, remoteStream) => {
    if (!err) {
      remoteStream.pipe(telemStream);
    }
  }
);

udpg.addPathway(
  { remote_name: 'filesService', remote_ip: '192.175.12.24', remote_port: 8005 },
  (err, remoteStream) => {
    if (!err) {
      remoteStream.pipe(filesStream);
    }
  }
);
```
As we can see above, the callback function will be called with an `Error` as its first argument if something goes wrong. If everything went fine, the first argument will be `null`. The second argument will be the NodeJS Stream object associated with this pathway. The third argument will be the string identifier for that pathway: either the passed `remote_name` value or a string generated by the UdpGroup that will look like `${remote_ip}_${remote_port}` (or just `${remote_ip}` if no remote port was associated with the pathway).

We can also use our UdpGroup to send messages from the Group's port to our services. For example, perhaps when the file service finishes receiving a file, it emits a confirmation code that should be sent back to the file service on the `Remote Device`.

```js
filesStream.on('fileComplete', hashCode => {
  udpg.send(Buffer.from(hashCode), 'filesService');
});
```
Since our UdpGroup recognizes the string `"fileService"` as one of our defined pathways, it will send the `hashCode` Buffer over UDP to `192.175.12.24:8005`.

# TODO
* Allow implementer to set default offset and length
* Allow split sends for messages that overrun the length
  - Should there be an option of truncate message to send on length or send multiple messages if send buffer is longer than length?

