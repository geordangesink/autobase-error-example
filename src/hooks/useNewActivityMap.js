import sodium from "sodium-native";
import { useState, useRef } from "react";

// handle user input and create the activity
export default () => {
  const [isEvent, setIsEvent] = useState(true); // by default, 'event' is active
  const customRepeatRef = useRef("");
  const titleRef = useRef("");
  const fromDateRef = useRef("");
  const fromTimeRef = useRef("");
  const untilDateRef = useRef("");
  const untilTimeRef = useRef("");
  const descriptionRef = useRef("");
  const repeatRef = useRef("no-repeat");
  const colorRef = useRef("#7B0323");
  const notificationRef = useRef("30m");

  // generate the activity object
  const getActivityObject = (opts = {}) => {
    const fromUTC = new Date(fromDateRef.current.value + "T" + fromTimeRef.current.value);
    const untilUTC = new Date(untilDateRef.current.value + "T" + untilTimeRef.current.value);

    const buffer = Buffer.alloc(32);
    sodium.randombytes_buf(buffer);
    const randomString = buffer.toString("hex"); // create random key

    // check for repeat (name the map after date or repeat)
    let fromDateOrRepeat;
    let groupKey;
    let dateAdditionals = "";
    if (repeatRef.current.value === "no-repeat") {
      fromDateOrRepeat = opts.from || fromUTC.toISOString();
      console.log("testing");
    } else {
      console.log("other test");
      dateAdditionals = new Map();
      sodium.randombytes_buf(buffer);
      fromDateOrRepeat = opts.repeat || repeatRef.current.value;
      groupKey = buffer.toString("hex");
    }

    const key = opts.key || groupKey || randomString;
    const value = new Map([
      ["from", fromUTC],
      ["until", untilUTC],
      ["dateAdditionals", opts.dateAdditionals || dateAdditionals], // additional dates (moved exceptions) for repeating activities
      ["dateExceptions", opts.dateExceptions || []], // exceptions for repeating activities (the dates that need to be left out)
      ["groupKey", opts.groupKey || groupKey], // group key for repeating activities
      ["isEvent", isEvent], // event ? or task (true/false)
      ["title", titleRef.current.value === "" ? "(No Title)" : titleRef.current.value],
      ["description", descriptionRef.current.value],
      ["complete", opts.complete || isEvent ? undefined : false], // set 'complete' to false if it's a task
      ["notification", notificationRef.current.value],
      ["repeat", repeatRef.current.value], // repeat setting
      ["customRepeat", opts.customRepeat || customRepeatRef.current], // cuntom repeat object
      ["color", colorRef.current.value], // default color or based on some logic
    ]);

    const activityValue = new Map([[key, value]]);
    const activityMap = new Map([[fromDateOrRepeat, activityValue]]);
    console.log(activityMap);
    return activityMap;
  };

  return {
    isEvent,
    setIsEvent,
    titleRef,
    fromDateRef,
    fromTimeRef,
    untilDateRef,
    untilTimeRef,
    descriptionRef,
    repeatRef,
    customRepeatRef,
    colorRef,
    notificationRef,
    getActivityObject,
  };
};
