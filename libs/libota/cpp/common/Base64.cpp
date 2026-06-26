#include "Base64.h"

#include <array>

namespace gtdev::ota {

namespace {

constexpr char kEncodeTable[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Maps an ASCII byte to its 6-bit Base64 value, or 0xFF if it is not part of
// the alphabet. Built once at first use.
const std::array<uint8_t, 256>& decodeTable() {
  static const std::array<uint8_t, 256> table = [] {
    std::array<uint8_t, 256> t{};
    t.fill(0xFF);
    for (uint8_t i = 0; i < 64; ++i) {
      t[static_cast<uint8_t>(kEncodeTable[i])] = i;
    }
    return t;
  }();
  return table;
}

} // namespace

std::string base64Encode(const std::vector<uint8_t>& bytes) {
  std::string out;
  out.reserve(((bytes.size() + 2) / 3) * 4);

  size_t i = 0;
  const size_t fullGroups = bytes.size() / 3;
  for (size_t g = 0; g < fullGroups; ++g, i += 3) {
    const uint32_t triple =
        (static_cast<uint32_t>(bytes[i]) << 16) |
        (static_cast<uint32_t>(bytes[i + 1]) << 8) |
        static_cast<uint32_t>(bytes[i + 2]);
    out.push_back(kEncodeTable[(triple >> 18) & 0x3F]);
    out.push_back(kEncodeTable[(triple >> 12) & 0x3F]);
    out.push_back(kEncodeTable[(triple >> 6) & 0x3F]);
    out.push_back(kEncodeTable[triple & 0x3F]);
  }

  const size_t remaining = bytes.size() - i;
  if (remaining == 1) {
    const uint32_t triple = static_cast<uint32_t>(bytes[i]) << 16;
    out.push_back(kEncodeTable[(triple >> 18) & 0x3F]);
    out.push_back(kEncodeTable[(triple >> 12) & 0x3F]);
    out.push_back('=');
    out.push_back('=');
  } else if (remaining == 2) {
    const uint32_t triple = (static_cast<uint32_t>(bytes[i]) << 16) |
        (static_cast<uint32_t>(bytes[i + 1]) << 8);
    out.push_back(kEncodeTable[(triple >> 18) & 0x3F]);
    out.push_back(kEncodeTable[(triple >> 12) & 0x3F]);
    out.push_back(kEncodeTable[(triple >> 6) & 0x3F]);
    out.push_back('=');
  }

  return out;
}

bool base64Decode(const std::string& encoded, std::vector<uint8_t>& out) {
  out.clear();
  out.reserve((encoded.size() / 4) * 3);

  const auto& table = decodeTable();
  uint32_t buffer = 0;
  int bitsCollected = 0;

  for (const char c : encoded) {
    if (c == '=') {
      break;
    }
    if (c == '\n' || c == '\r' || c == ' ' || c == '\t') {
      continue;
    }
    const uint8_t value = table[static_cast<uint8_t>(c)];
    if (value == 0xFF) {
      out.clear();
      return false;
    }
    buffer = (buffer << 6) | value;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      out.push_back(static_cast<uint8_t>((buffer >> bitsCollected) & 0xFF));
    }
  }

  return true;
}

} // namespace gtdev::ota
