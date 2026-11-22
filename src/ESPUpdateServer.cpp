#ifdef ESP8266
#include <ESP8266WiFi.h>
#include <WiFiClient.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPUpdateServer.h>
#include <ESP8266mDNS.h>
#include <FS.h>
#elif defined(ESP32)
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>

#include <FS.h>

#if UseLittleFS
#include <LittleFS.h>
#else
#include <SPIFFS.h>
#endif

#include "ESP32HTTPUpdateServer.h"
#include "EepromAccess.h"
#include "EepromManager.h"
#endif

#include <WiFiClient.h>

#include <ArduinoJson.h>
#include "Config.h"
#include "ExternalData.h"
#include "Y2TSettings.h"

#define EXTERNALDATA_ON_SYNC_SERVER false

#if SerialDebug
#define DBG_PRINT(...) DebugPort.print(__VA_ARGS__)
#define DBG_PRINTLN(...) DebugPort.println(__VA_ARGS__)
#else
#define DBG_PRINT(...)
#define DBG_PRINTLN(...)
#endif

#if (DEVELOPMENT_OTA == true) || (DEVELOPMENT_FILEMANAGER == true)
#if defined(ESP32)
static WebServer server(UPDATE_SERVER_PORT);
#else
static ESP8266WebServer server(UPDATE_SERVER_PORT);
#endif
#endif

#if DEVELOPMENT_OTA == true
#if ESP8266
static ESP8266HTTPUpdateServer httpUpdater;
#elif ESP32
static ESP32HTTPUpdateServer httpUpdater;
#endif

#endif

#if DEVELOPMENT_FILEMANAGER == true

#include "edit_html_gz.h"

#define FS_FORMAT_PATH "/fsformat"

//holds the current upload
static File fsUploadFile;
extern String getContentType(String filename);

String getResponseContentType(String filename){
  if(server.hasArg("download")) return "application/octet-stream";
  return getContentType(filename);
}

static bool handleFileRead(String path){
  DBG_PRINTLN("handleFileRead: " + path);
  if(path.endsWith("/")) path += "index.htm";
  String contentType = getResponseContentType(path);
  String pathWithGz = path + ".gz";
  if(FileSystem.exists(pathWithGz) || FileSystem.exists(path)){
    if(FileSystem.exists(pathWithGz))
      path += ".gz";
    File file = FileSystem.open(path, "r");
    /*size_t sent = */ server.streamFile(file, contentType);
    file.close();
    return true;
  }
  return false;
}

static void handleFileUpload(void){
  if(server.uri() != "/edit") return;
  HTTPUpload& upload = server.upload();
  if(upload.status == UPLOAD_FILE_START){
    String filename = upload.filename;
    if(!filename.startsWith("/")) filename = "/"+filename;
    DBG_PRINT("handleFileUpload Name: "); DBG_PRINTLN(filename);
    fsUploadFile = FileSystem.open(filename, "w");
    filename = String();
  } else if(upload.status == UPLOAD_FILE_WRITE){
    //DBG_PRINT("handleFileUpload Data: "); DBG_PRINTLN(upload.currentSize);
    if(fsUploadFile)
      fsUploadFile.write(upload.buf, upload.currentSize);
  } else if(upload.status == UPLOAD_FILE_END){
    if(fsUploadFile)
      fsUploadFile.close();
    DBG_PRINT("handleFileUpload Size: "); DBG_PRINTLN(upload.totalSize);
  }
}

static void handleFileDelete(void){
  if(server.args() == 0) return server.send(500, "text/plain", "BAD ARGS");
  String path = server.arg(0);
  DBG_PRINTLN("handleFileDelete: " + path);
  if(path == "/")
    return server.send(500, "text/plain", "BAD PATH");
  if(!FileSystem.exists(path))
    return server.send(404, "text/plain", "FileNotFound");
  FileSystem.remove(path);
  server.send(200, "text/plain", "");
  path = String();
}
static void handleDirCreate(void){

  if(server.args() == 0)
    return server.send(500, "text/plain", "BAD ARGS");
  String path = server.arg(0);
  DBG_PRINTLN("handleDirCreate: " + path);
  if(path == "/")
    return server.send(500, "text/plain", "BAD PATH");
  if(FileSystem.exists(path))
    return server.send(500, "text/plain", "FILE EXISTS");

  if(FileSystem.mkdir(path)){
    server.send(200, "text/plain", "");
  }else{
    server.send(500, "text/plain", "CREATE FAILED");
  }
}
#if 0
static void handleFileCreate(void){
  if(server.args() == 0)
    return server.send(500, "text/plain", "BAD ARGS");
  String path = server.arg(0);
  DBG_PRINTLN("handleFileCreate: " + path);
  if(path == "/")
    return server.send(500, "text/plain", "BAD PATH");
  if(FileSystem.exists(path))
    return server.send(500, "text/plain", "FILE EXISTS");
  File file = FileSystem.open(path, "w");
  if(file)
    file.close();
  else
    return server.send(500, "text/plain", "CREATE FAILED");
  server.send(200, "text/plain", "");
  path = String();
}
#endif
static void handleFileList(void) {
  if(!server.hasArg("dir")) {server.send(500, "text/plain", "BAD ARGS"); return;}

  String path = server.arg("dir");
  DBG_PRINTLN("handleFileList: " + path);
  // linked list(queue) is needed. 
  // avoid recursive call, which might open too many directories 
  #if ESP32
  File dir = FileSystem.open(path);
 

//  DBG_PRINTF("length: %d",exlen);
  #else
  Dir dir = FileSystem.openDir(path);
  #endif
  //path = String();

  String output = "[";
  #if ESP32

  File entry = dir.openNextFile();
  while(entry){

  #else
  while(dir.next()){
    File entry = dir.openFile("r");
  #endif
    if (output != "[") output += ',';
    #if UseLittleFS
    bool isDir = entry.isDirectory();
    #else
    bool isDir = false;
    #endif

    DBG_PRINTF(" %s [%s]\n ", entry.name(),isDir? "DIR":"FILE");

    output += "{\"type\":\"";
    output += (isDir)? "dir":"file";
    output += "\",\"name\":\"";

    //DBG_PRINTF("%s, %s, cmp:%d, ", entry.name(),path.c_str(), strncmp(entry.name(),path.c_str(),path.length()));
    String name=(entry.name());
    if(name.startsWith(path)){
      
      int exlen =path.length();  
      if(path.charAt(exlen - 1) != '/') exlen ++;
      output += name.substring(exlen);
    }else{
       if(entry.name()[0] == '/'){
        output += name.substring(1);
       }else{
        output += name;
       }
    }
    #if 0
    #if UseLittleFS
    #if ESP32
    // the name is so complicated.
    // 
    output += String(entry.name()).substring(exlen);
    #else
    output += entry.name();
    #endif
    #else
    output += String(entry.name()).substring(1);
    #endif
    #endif
    output += "\"}";
    entry.close();  
  #if defined(ESP32)
    entry = dir.openNextFile();
  #endif

  }

  output += "]";
  DBG_PRINTF(" ret: %s \n",output.c_str());
  server.send(200, "text/json", output);
}

#endif

#if (DEVELOPMENT_OTA == true) || (DEVELOPMENT_FILEMANAGER == true)

void ESPUpdateServer_setup(const char* user, const char* pass){

#if DEVELOPMENT_FILEMANAGER == true
  //SERVER INIT
  //list directory
  server.on("/list", HTTP_GET, handleFileList);
  //load editor
  server.on(FILE_MANAGEMENT_PATH, HTTP_GET, [](){
	  server.sendHeader("Content-Encoding", "gzip");
	   server.send_P(200,"text/html",edit_htm_gz,edit_htm_gz_len);
  });
  //create file
  server.on("/edit", HTTP_PUT, handleDirCreate);
  //delete file
  server.on("/edit", HTTP_DELETE, handleFileDelete);
  //first callback is called after the request has ended with all parsed arguments
  //second callback handles file uploads at that location
  server.on("/edit", HTTP_POST, [](){ server.send(200, "text/plain", ""); }, handleFileUpload);

  //called when the url is not defined here
  //use it to load content from FileSystem
  server.onNotFound([](){
    if(!handleFileRead(server.uri()))
      server.send(404, "text/plain", "FileNotFound");
  });

  //get heap status, analog input value and all GPIO statuses in one json call
  #if 0
  server.on("/all", HTTP_GET, [](){
    String json = "{";
    json += "\"heap\":"+String(ESP.getFreeHeap());
    json += ", \"analog\":"+String(analogRead(A0));
    json += ", \"gpio\":"+String((uint32_t)(((GPI | GPO) & 0xFFFF) | ((GP16I & 0x01) << 16)));
    json += "}";
    server.send(200, "text/json", json);
    json = String();
  });
  #endif

  // One-shot FS format, like /restart on the main server: authenticated plain
  // text endpoint. The old /format-spiffs confirmation pages were dropped; see
  // README.md. preFormat/postFormat keep the EEPROM-backed settings intact.
  server.on(FS_FORMAT_PATH, HTTP_GET, [user, pass](){
      if(!server.authenticate(user, pass))
          return server.requestAuthentication();
      server.send(200, "text/plain", "Done, formatting..");
      theSettings.preFormat();
      FileSystem.format();
      theSettings.postFormat();
#if ESP32
      eepromAccess.saveDeviceDefinition();
      eepromManager.storeTempConstantsAndSettings();
#endif
  });

#endif

#if EXTERNALDATA_ON_SYNC_SERVER
     server.on("/gravity",HTTP_POST, [](){
        if (server.hasArg("plain")== false){ //Check if body received
            server.send(200, "text/plain", "");
            return;
        }
        uint8_t error;
        String json=server.arg("plain");
        char *data=(char*)malloc(json.length() +1);
        if(!data){
            server.send(500);
            return;
        }
        strcpy(data,json.c_str());
		if(externalData.processGravityReport(data,json.length(),false,error)){
    		server.send(200,"application/json","{}");
		}else{
		     server.send(500);
		}
     });
#endif

#if DEVELOPMENT_OTA == true
 // Flash update server
#if ESP8266
	httpUpdater.setup(&server,SYSTEM_UPDATE_PATH,user,pass);
#elif ESP32
  httpUpdater.setup(server,SYSTEM_UPDATE_PATH,user,pass);
#endif
#endif

  server.begin();
  DBG_PRINTLN("HTTP Update server started\n");

}

void ESPUpdateServer_loop(void){
  server.handleClient();
}

#endif
