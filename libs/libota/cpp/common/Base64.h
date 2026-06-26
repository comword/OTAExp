#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace gtdev::ota {

// Minimal, dependency-free Base64 codec. The JSI layer exchanges all binary
// payloads (firmware image, data chunks, control packets, status notifications)
// as Base64 strings, so the OTA engine never has to know about JSI types.
std::string base64Encode(const std::vector<uint8_t>& bytes);

// Decodes a Base64 string. Whitespace is ignored; any other invalid character
// causes the function to return false and leaves `out` empty.
bool base64Decode(const std::string& encoded, std::vector<uint8_t>& out);

} // namespace gtdev::ota
