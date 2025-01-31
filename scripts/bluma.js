function createElementFromHTML(htmlString) {
  var div = document.createElement("div");
  div.innerHTML = htmlString.trim();
  return div.firstChild;
}
function toCSV(guests) {
  const headers =
    "Name,Headline,Website,Instagram URL,LinkedIn URL,TikTok URL,Twitter URL,YouTube URL";
  const csvRows = [headers]; // start with the headers

  for (const guest of guests) {
    const row = [
      guest.name,
      (guest.bio_short || "").replace(/\r?\n|\r/g, ""),
      guest.website || "",
      toURL("https://instagram.com/", guest.instagram_handle),
      toURL("https://linkedin.com/in/", guest.linkedin_handle),
      toURL("https://tiktok.com/", guest.tiktok_handle),
      toURL("https://x.com/", guest.twitter_handle),
      toURL("https://youtube.com/", guest.youtube_handle),
    ].map((field) => `"${field.replace(/"/g, '""')}"`); // escape quotes

    csvRows.push(row.join(","));
  }

  return csvRows.join("\n");
}
function toURL(prefix, handle) {
  if (handle) {
    return `${prefix}${handle}`;
  }
  return "";
}
async function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        resolve(true);
      })
      .catch((err) => {
        resolve(false);
      });
  });
}

function getEventID() {
  const metaTag = document.querySelector('meta[name="apple-itunes-app"]');
  const content = metaTag ? metaTag.getAttribute("content") : "";
  const appArgumentMatch = content.match(
    /app-argument=luma:\/\/event\/([^,]+)/,
  );
  const eventId = appArgumentMatch ? appArgumentMatch[1] : null;
  return eventId;
}

async function fetchTicketKey(eventApiId) {
  const url = `https://api.lu.ma/event/get?event_api_id=${eventApiId}`;
  let res = await fetch(url, {
    credentials: "include",
  });
  res = await res.json();
  return res["guest_data"]["ticket_key"];
}

async function fetchGuestList(eventApiId, ticketKey) {
  const BASE_URL = `https://api.lu.ma/event/get-guest-list?event_api_id=${eventApiId}&ticket_key=${ticketKey}&pagination_limit=100`;
  let initialResult = await fetch(BASE_URL, {
    credentials: "include",
  });
  let initialResultData = await initialResult.json();
  let output = initialResultData["entries"];

  let hasMore = initialResultData["has_more"];
  let nextCursor = initialResultData["next_cursor"];
  while (hasMore) {
    let url = BASE_URL + `&pagination_cursor=${nextCursor}`;
    setTimeout(10);
    let res = await fetch(url);
    res = await res.json();
    output = output.concat(res["entries"]);
    hasMore = res["has_more"];
    nextCursor = res["next_cursor"];
  }
  return output;
}

async function getGuestList() {
  let eventID = getEventID();
  if (!eventID) {
    throw new Error("No event ID");
  }
  let ticketKey = await fetchTicketKey(eventID);
  if (!ticketKey) {
    throw new Error("No ticket key");
  }
  let guestList = await fetchGuestList(eventID, ticketKey);
  let guestIDs = guestList.map((item) => item["api_id"]);

  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(guestIDs, function (items) {
      if (chrome.runtime.lastError) {
        reject(
          new Error(
            "Error fetching data from storage: " +
              chrome.runtime.lastError.message,
          ),
        );
      } else {
        const updatedGuestList = guestList.map((guest) => ({
          ...guest,
          bluma: items[guest.api_id] || {},
        }));
        updatedGuestList.sort((a, b) => {
          if (a.bluma.favorited && !b.bluma.favorited) {
            return -1;
          } else if (!a.bluma.favorited && b.bluma.favorited) {
            return 1;
          } else {
            if (a.name) {
              return a.name.localeCompare(b.name);
            } else {
              return 1;
            }
          }
        });
        resolve(updatedGuestList);
      }
    });
  });
}

function createBackdrop() {
  const backdrop = document.createElement("div");
  backdrop.className = "lux-backdrop";
  backdrop.style.opacity = "1";
  return document.body.appendChild(backdrop);
}

function createModal(guests) {
  let modal = document.createElement("div");
  modal.className = "lux-overlay modal";
  modal.innerHTML = `
        <div class="lux-modal lux-alert" style="opacity: 1; transform: none;">
          <div class="lux-modal-body overflow-auto">
            <div class="jsx-885212934 lux-alert-top">
              <div class="jsx-866386672">
                <h3 class="jsx-866386672 title">${guests.length} Guests</h3>
              </div>
            </div>
            <div class="jsx-531347415">
              <div class="jsx-531347415 divider bluma-divider animated"></div>
              <div class="jsx-531347415 bluma-guest-list flex-column outer overflow-auto">

              </div>
            </div>
          </div>
        </div>
      `;
  modal = document.body.appendChild(modal);
  let guestElems = guests.map((guest) => {
    let imgUrl = getGuestAvatarURL(guest);
    let socialLinks = createGuestSocialLinks(guest);
    let bio =
      guest["bio_short"] == null || guest["bio_short"] == ""
        ? ""
        : `<div class="text-tinted bluma-desc fs-sm">${guest["bio_short"]}</div>`;

    let guestElem = createElementFromHTML(`
    <div class="flex-start gap-2 spread">
      <a class="" href="/user/${guest["api_id"]}">
        <div class="flex-start min-width-0 text-primary" style="gap: 0.75rem;">
        <div class="avatar-wrapper bluma-avatar-wrapper">
          <img class="rounded" style="border-radius: 1000px;" src="${imgUrl}" width="32" height="32" alt="Profile picture for ${guest["name"]}" title="Profile picture for ${guest["name"]}" fetchpriority="auto" loading="eager">
        </div>
        <div class="flex-center min-width-0" style="flex-direction: column;align-items: flex-start;">
          <div class="name text-ellipses fw-medium" title="${guest["name"]}">${guest["name"]}</div>
            ${bio}
          </div>
        </div>
      </a>

    </div>`);
    guestElem.appendChild(socialLinks);
    return guestElem;
  });
  modal.getElementsByClassName("bluma-guest-list")[0].append(...guestElems);
  modal
    .getElementsByClassName("lux-modal-body")[0]
    .append(createCopyToClipboardButton(guests));
  return modal;
}
function getGuestAvatarURL(guest) {
  let imgPath = guest["avatar_url"];
  let imgUrl = null;
  if (imgPath.startsWith("https://images.lumacdn.com/")) {
    // Custom profile image
    imgPath = imgPath.substring(27);
    imgUrl = `https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,dpr=2,background=white,quality=75,width=32,height=32/${imgPath}`;
  } else if (imgPath.startsWith("https://cdn.lu.ma/")) {
    // Default profile image
    imgPath = imgPath.substring(34);
    imgUrl = `https://cdn.lu.ma/cdn-cgi/image/format=auto,fit=cover,dpr=2,background=white,quality=75,width=32,height=32/avatars-default/${imgPath}`;
  }
  return imgUrl;
}
function createGuestSocialLinks(guest) {
  let links = [];
  if (guest["instagram_handle"]) {
    let newLink = `
      <div class="jsx-2703338562 social-link bluma-social-link regular">
        <a href="https://instagram.com/${guest["instagram_handle"]}" class="lux-menu-trigger-wrapper" target="_blank" rel="nofollow noopener">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jsx-2703338562"><g fill="currentColor" fill-rule="evenodd"><path fill-rule="nonzero" d="M13.38 3.8a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0"></path><path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m0-1.6a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8"></path><path d="M0 7.68c0-2.688 0-4.032.523-5.06A4.8 4.8 0 0 1 2.621.524C3.648 0 4.99 0 7.68 0h.64c2.688 0 4.032 0 5.06.523a4.8 4.8 0 0 1 2.097 2.098C16 3.648 16 4.99 16 7.68v.64c0 2.688 0 4.032-.523 5.06a4.8 4.8 0 0 1-2.098 2.097C12.352 16 11.01 16 8.32 16h-.64c-2.688 0-4.032 0-5.06-.523a4.8 4.8 0 0 1-2.097-2.098C0 12.352 0 11.01 0 8.32zM7.68 1.6h.64c1.37 0 2.302.001 3.022.06.702.057 1.06.161 1.31.289a3.2 3.2 0 0 1 1.4 1.398c.127.25.23.61.288 1.31.059.72.06 1.652.06 3.023v.64c0 1.37-.001 2.302-.06 3.022-.057.702-.161 1.06-.289 1.31a3.2 3.2 0 0 1-1.398 1.4c-.25.127-.61.23-1.31.288-.72.059-1.652.06-3.023.06h-.64c-1.37 0-2.302-.001-3.022-.06-.702-.057-1.06-.161-1.31-.289a3.2 3.2 0 0 1-1.4-1.398c-.127-.25-.23-.61-.288-1.31-.059-.72-.06-1.652-.06-3.023v-.64c0-1.37.001-2.302.06-3.022.057-.702.161-1.06.289-1.31a3.2 3.2 0 0 1 1.398-1.4c.25-.127.61-.23 1.31-.288.72-.059 1.652-.06 3.023-.06"></path></g></svg>
        </a>
      </div>`;
    links.push(createElementFromHTML(newLink));
  }
  if (guest["twitter_handle"]) {
    let newLink = `
      <div class="jsx-1428039309 social-link bluma-social-link regular">
        <a href="https://x.com/${guest["twitter_handle"]}" class="lux-menu-trigger-wrapper" target="_blank" rel="nofollow noopener">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" class="jsx-2703338562"><path fill="currentColor" d="m108.783 107.652-38.24-55.748.066.053L105.087 12H93.565L65.478 44.522 43.174 12H12.957l35.7 52.048-.005-.005L11 107.653h11.522L53.748 71.47l24.817 36.182zM38.609 20.696l53.652 78.26h-9.13l-53.696-78.26z"></path></svg>
        </a>
      </div>`;
    links.push(createElementFromHTML(newLink));
  }
  if (guest["linkedin_handle"]) {
    let newLink = `
      <div class="jsx-1428039309 social-link bluma-social-link regular">
        <a href="https://linkedin.com${guest["linkedin_handle"]}" class="lux-menu-trigger-wrapper" target="_blank" rel="nofollow noopener">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 16 16" class="jsx-2703338562"><path fill="currentColor" d="M13.667 1.333H2.333a1 1 0 0 0-1 1v11.334a1 1 0 0 0 1 1h11.334a1 1 0 0 0 1-1V2.333a1 1 0 0 0-1-1M5.333 12.667h-2v-6h2zm-1-7.167a1.167 1.167 0 1 1 1.2-1.167 1.187 1.187 0 0 1-1.2 1.167m8.334 7.167h-2v-3.16c0-.947-.4-1.287-.92-1.287a1.16 1.16 0 0 0-1.08 1.24.4.4 0 0 0 0 .093v3.114h-2v-6H8.6v.866a2.07 2.07 0 0 1 1.8-.933c1.033 0 2.24.573 2.24 2.44z"></path></svg>
        </a>
      </div>`;
    links.push(createElementFromHTML(newLink));
  }
  if (guest["website"]) {
    let newLink = `
      <div class="jsx-2703338562 social-link bluma-social-link regular">
        <a href="${guest["website"]}" class="lux-menu-trigger-wrapper" target="_blank" rel="nofollow noopener">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jsx-2703338562"><path fill="currentColor" fill-rule="evenodd" d="M9.394 12.674c-.604 1.208-1.178 1.42-1.394 1.42s-.79-.212-1.394-1.42c-.491-.982-.85-2.368-.932-3.97h4.652c-.082 1.602-.44 2.988-.932 3.97m.932-5.377H5.674c.082-1.603.44-2.989.932-3.971C7.21 2.118 7.784 1.906 8 1.906s.79.212 1.394 1.42c.491.982.85 2.368.932 3.97m1.408 1.406c-.09 1.915-.538 3.622-1.21 4.846a6.1 6.1 0 0 0 3.53-4.846zm2.32-1.406h-2.32c-.09-1.915-.538-3.622-1.21-4.845a6.1 6.1 0 0 1 3.53 4.845m-9.788 0c.09-1.915.538-3.622 1.21-4.845a6.1 6.1 0 0 0-3.53 4.845zm-2.32 1.406a6.1 6.1 0 0 0 3.53 4.846c-.672-1.224-1.12-2.93-1.21-4.846zM15.5 8a7.5 7.5 0 1 0-15 0 7.5 7.5 0 0 0 15 0"></path></svg>
        </a>
      </div>`;
    links.push(createElementFromHTML(newLink));
  }

  links.push(createFavoriteButton(guest));

  let output = createElementFromHTML(
    `<div class="jsx-1428039309 social-links flex-center regular"></div>`,
  );
  output.append(...links);
  return output;
}
function createFavoriteButton(guest) {
  let checked = guest["bluma"]["favorited"] ? "checked" : "unchecked";
  let output = createElementFromHTML(`
    <label aria-label="Click to Favorite/Unfavorite" class="lux-menu-trigger-wrapper btn luma-button flex-center small light solid variant-color-light icon-only-compact label-for-check" for="favorite-${guest["api_id"]}">
      <input ${checked} type="checkbox" class="check-with-label bluma-favorited-guest-checkbox" id="favorite-${guest["api_id"]}" />
      <svg class="checked"   xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="m3 7.86 2.667 3.64L13 4.5"></path></svg>
      <svg class="unchecked" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 2v12M2 8h12"></path></svg>
    </label>`);
  output.addEventListener("change", (event) => {
    favoriteGuest(event, guest["api_id"]);
  });
  return output;
}
function createCopyToClipboardButton(guests) {
  let button = createElementFromHTML(
    `<button style="width: 100%;margin-top:1rem;" class="btn luma-button flex-center small light solid variant-color-light no-icon" type="button">
      <div class="label">Copy guest list to clipboard as CSV</div>
    </button>`,
  );
  button.addEventListener("click", () => {
    let csv = toCSV(guests);
    copyToClipboard(csv).then((res) => {
      if (res) {
        button.innerHTML = `<div class="label">Copied to clipboard!</div>`;
      } else {
        button.innerHTML = `<div class="label">Failed...?</div>`;
      }
    });
  });
  return button;
}

function favoriteGuest(event, apiID) {
  const { checked } = event.target;
  chrome.storage.sync.get([apiID], function (items) {
    if (chrome.runtime.lastError) {
      throw new Error(
        "Error fetching data from storage: " + chrome.runtime.lastError.message,
      );
    } else {
      let value = items[apiID] ?? {};
      value["favorited"] = checked;
      let setValue = {};
      setValue[apiID] = value;
      chrome.storage.sync.set(setValue).then((result) => {
        if (chrome.runtime.lastError) {
          throw new Error(
            "Error setting data: " + chrome.runtime.lastError.message,
          );
        }
      });
    }
  });
}

function showBetterGuestList() {
  let backdrop = createBackdrop();

  getGuestList().then((result) => {
    let modal = createModal(result);
    modal.addEventListener("click", (event) => {
      backdrop.remove();
      modal.remove();
    });
    modal.firstElementChild.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });
}

function addListenerToGuestListButton() {
  let guestsButton = document.querySelector(".guests-button");
  if (guestsButton) {
    guestsButton.addEventListener(
      "click",
      (event) => {
        event.stopImmediatePropagation();
        showBetterGuestList();
      },
      true,
    );
    return true;
  }
  return false;
}

addListenerToGuestListButton();
document.body.addEventListener("click", function (event) {
  if (false && event.target.classList.contains("event-link")) {
    let interval = null;
    let iterations = 0;
    interval = setInterval(() => {
      let res = addListenerToGuestListButton();
      iterations += 1;
      if (res || iterations > 500) {
        clearInterval(interval);
      }
    }, 50);
  }
});
