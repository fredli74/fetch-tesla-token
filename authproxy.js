#!/usr/bin/env node

const http = require("http");
const https = require("https");
const fs = require("fs");

const PORT = Number(process.env["LISTEN_PORT"]) || 15198;
const HOSTNAME = Number(process.env["LISTEN_HOST"]) || "";

const TESLA_AUTH_HOST = `owner-api.teslamotors.com`;
const TESLA_AUTH_PATH = `/oauth/token?grant_type=password`;
const TESLA_CLIENT_ID = `81527cff06843c8634fdc09e8ac0abefb46ac849f38fe1e431c2ef2106796384`;
const TESLA_CLIENT_SECRET = `c7257eb71a564034f9419ee651c7d0e5f7aa6bfbd18bafb5c5c033b093bb2fa3`;

http
  .createServer(function(request, response) {
    let inputBody = "";
    request
      .on("data", chunk => (inputBody += chunk))
      .on("end", () => {
        const inputData = inputBody && JSON.parse(inputBody);

        if (request.url === "/proxy") {
          /** Tesla API Proxy **/

          const postData = JSON.stringify({
            grant_type: "password",
            client_id: TESLA_CLIENT_ID,
            client_secret: TESLA_CLIENT_SECRET,
            email: inputData.email,
            password: inputData.password
          });

          const options = {
            method: "POST",
            protocol: "https:",
            host: TESLA_AUTH_HOST,
            path: TESLA_AUTH_PATH,
            headers: {
              Accept: "application/json",
              "User-Agent": "TeslaAPI-proxy/1.0 (Node.js)",
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postData)
            }
          };

          const proxyRequest = https.request(options, proxyResponse => {
            response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
            proxyResponse.pipe(
              response,
              { end: true }
            );
          });
          proxyRequest.write(postData);
          proxyRequest.end();
        } else if (request.url === "/") {
          /** HTML page **/

          fs.readFile("index.html", "binary", (err, file) => {
            if (!err) {
              response.writeHead(200);
              response.write(file, "binary");
            } else {
              response.writeHead(500);
            }
            response.end();
          });
        } else {
          response.writeHead(404);
          response.end();
        }
      })
      .on("error", () => {
        response.writeHead(500);
        response.end();
      });
  })
  .listen(PORT, HOSTNAME)
  .on("listening", () => {
    console.log(`Connect to http://localhost:${PORT}`);
  });
