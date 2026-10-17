#!/usr/bin/env bash
# ShopStream smoke test — exercises every public/auth-protected flow end-to-end.
#
# Usage:  ./scripts/smoke-test.sh                 (gateway on localhost:3000)
#         BASE=http://host:3000 ./scripts/smoke-test.sh
#
# Requires: curl, jq. Creates a throwaway user + product, then cleans up.
set -u
BASE="${BASE:-http://localhost:3000}"
PASS=0; FAIL=0

check() { # check <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS: $1";
  else FAIL=$((FAIL+1)); echo "FAIL: $1 (expected [$2] got [$3])"; fi
}

# ---------- 1. Public reads stay public ----------
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 $BASE/api/v1/products)
check "GET products public" 200 "$code"

# ---------- 2. Unauthenticated mutations rejected ----------
out=$(curl -s -m 5 -X POST $BASE/api/v1/products -H 'Content-Type: application/json' -d '{"name":"Nope","price":1}')
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST $BASE/api/v1/products -H 'Content-Type: application/json' -d '{"name":"Nope","price":1}')
check "POST products no token -> 401" 401 "$code"
check "POST products no token body" '{"error":"Authentication required"}' "$out"

code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST $BASE/api/v1/products -H 'Content-Type: application/json' -H 'Authorization: Bearer garbage.token.here' -d '{"name":"Nope","price":1}')
check "POST products bad token -> 401" 401 "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 $BASE/api/v1/orders)
check "GET orders no token -> 401" 401 "$code"

# ---------- 3. Register + login ----------
STAMP=$(date +%s)
EMAIL="jwt-test-$STAMP@test.com"
reg=$(curl -s -m 5 -X POST $BASE/api/v1/auth/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"pass123\",\"name\":\"JWT Tester\"}")
USER_ID=$(echo "$reg" | jq -r '.user.id // empty')
check "register creates user" "ok" "$( [ -n "$USER_ID" ] && echo ok )"

login=$(curl -s -m 5 -X POST $BASE/api/v1/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"pass123\"}")
TOKEN=$(echo "$login" | jq -r '.token // empty')
if [ -n "$TOKEN" ]; then PASS=$((PASS+1)); echo "PASS: login returns token";
else FAIL=$((FAIL+1)); echo "FAIL: login token missing ($login)"; fi

AUTH=(-H "Authorization: Bearer $TOKEN")

# ---------- 4. Ownership on users ----------
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 $BASE/api/v1/users/$USER_ID "${AUTH[@]}")
check "GET own user -> 200" 200 "$code"

OTHER_ID="11111111-1111-1111-1111-111111111111"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 $BASE/api/v1/users/$OTHER_ID "${AUTH[@]}")
check "GET other user -> 403" 403 "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 $BASE/api/v1/users/$USER_ID)
check "GET user no token -> 401" 401 "$code"

# ---------- 5. Create product with token (auto inventory sync) ----------
prod=$(curl -s -m 10 -X POST $BASE/api/v1/products "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d "{\"name\":\"JWT Test Phone $STAMP\",\"price\":499.99,\"category\":\"Electronics\"}")
PID=$(echo "$prod" | jq -r '.product._id // empty')
SYNCED=$(echo "$prod" | jq -r '.inventorySync // empty')
if [ -n "$PID" ]; then PASS=$((PASS+1)); echo "PASS: product created with token ($PID)";
else FAIL=$((FAIL+1)); echo "FAIL: product create ($prod)"; fi
echo "  inventorySync: $(echo "$prod" | jq -c '.inventorySync')"

# ---------- 6. Inventory read is public, add requires token ----------
sleep 1
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 $BASE/api/v1/inventory/$PID)
check "GET inventory public -> 200" 200 "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST $BASE/api/v1/inventory/$PID/add \
  -H 'Content-Type: application/json' -d '{"quantity":10}')
check "POST inventory add no token -> 401" 401 "$code"

inv=$(curl -s -m 5 -X POST $BASE/api/v1/inventory/$PID/add "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{"quantity":10}')
qty=$(echo "$inv" | jq -r '.inventory.quantity // -1')
check "POST inventory add with token -> qty 10" 10 "$qty"

# ---------- 7. Order flows ----------
ord=$(curl -s -m 10 -X POST $BASE/api/v1/orders "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"items\":[{\"productId\":\"$PID\",\"productName\":\"JWT Test Phone\",\"quantity\":2,\"price\":499.99}]}")
OID=$(echo "$ord" | jq -r '.order._id // empty')
if [ -n "$OID" ]; then PASS=$((PASS+1)); echo "PASS: order placed (matching userId)";
else FAIL=$((FAIL+1)); echo "FAIL: order ($ord)"; fi
STATUS=$(echo "$ord" | jq -r '.order.status // empty')
check "order status CONFIRMED" CONFIRMED "$STATUS"
TOTAL=$(echo "$ord" | jq -r '.order.total // -1')
check "order total server-side" 999.98 "$TOTAL"

qty=$(curl -s -m 5 $BASE/api/v1/inventory/$PID | jq -r '.inventory.quantity // -1')
check "stock deducted 10 -> 8" 8 "$qty"

# impersonation: userId of someone else
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST $BASE/api/v1/orders "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$OTHER_ID\",\"items\":[{\"productId\":\"$PID\",\"productName\":\"x\",\"quantity\":1,\"price\":1}]}")
check "order with other userId -> 403" 403 "$code"

# insufficient stock -> 400 + rollback (nothing deducted)
out=$(curl -s -m 10 -X POST $BASE/api/v1/orders "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"items\":[{\"productId\":\"$PID\",\"productName\":\"JWT Test Phone\",\"quantity\":100,\"price\":499.99}]}")
check "insufficient stock error" '{"error":"Order failed: Insufficient stock"}' "$out"
qty=$(curl -s -m 5 $BASE/api/v1/inventory/$PID | jq -r '.inventory.quantity // -1')
check "stock unchanged after failed order" 8 "$qty"

# ---------- 8. Order reads ----------
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 $BASE/api/v1/orders/$OID "${AUTH[@]}")
check "GET own order -> 200" 200 "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 $BASE/api/v1/orders/user/$USER_ID "${AUTH[@]}")
check "GET own orders list -> 200" 200 "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 $BASE/api/v1/orders/user/$OTHER_ID "${AUTH[@]}")
check "GET other user orders -> 403" 403 "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 $BASE/api/v1/orders/$OID)
check "GET order no token -> 401" 401 "$code"

# ---------- 9. Status update requires auth ----------
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X PUT $BASE/api/v1/orders/$OID/status \
  -H 'Content-Type: application/json' -d '{"status":"SHIPPED"}')
check "PUT status no token -> 401" 401 "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X PUT $BASE/api/v1/orders/$OID/status "${AUTH[@]}" \
  -H 'Content-Type: application/json' -d '{"status":"SHIPPED"}')
check "PUT status with token -> 200" 200 "$code"

# ---------- 10. Product mutation requires auth ----------
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X PUT $BASE/api/v1/products/$PID \
  -H 'Content-Type: application/json' -d '{"price":599.99}')
check "PUT product no token -> 401" 401 "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X DELETE $BASE/api/v1/products/$PID "${AUTH[@]}")
check "DELETE product with token -> 200" 200 "$code"

echo
echo "==============================="
echo "PASS: $PASS  FAIL: $FAIL"
echo "==============================="
[ "$FAIL" -eq 0 ]
